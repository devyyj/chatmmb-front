// hooks/useStompChat.js
// 목적: 모바일 백그라운드 복귀/네트워크 전환 시 안정적 재연결 + 상태 변경 시스템 메시지 출력
// 개선점:
// - 콜드스타트 억제(isColdStartRef, 800ms)
// - 최초 연결 전에는 "백그라운드 복귀" 메시지 차단(everConnectedRef)
// - 중복 트리거 쿨다운(lastReconnectAtRef, 500ms)
// - 시스템 메시지 중복/정렬 안정화(seq, 최근 3초 dedup)
// - StrictMode 유무와 무관하게 초기 새로고침 시 불필요한 시스템 메시지 방지
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs.min.js';

/** UUID 생성 (crypto 지원 없을 때 폴백) */
function genUUID() {
  return globalThis.crypto?.randomUUID?.()
    || `uid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 브라우저 단위 presence 키 (localStorage 불가 시 메모리 폴백) */
function getPresenceKey() {
  try {
    const k = localStorage.getItem('presenceKey');
    if (k) return k;
    const nk = genUUID();
    localStorage.setItem('presenceKey', nk);
    return nk;
  } catch {
    return genUUID();
  }
}

/** 안전한 activate 헬퍼: 이미 활성화된 경우 중복 호출 방지 */
function ensureActivate(client) {
  if (!client) return;
  if (!client.active) client.activate();
}

export function useStompChat() {
  // ====== 상태 ======
  const [messages, setMessages] = useState([]);
  const [presenceCount, setPresenceCount] = useState(0);
  const [connStatus, setConnStatus] = useState('connecting');   // connecting | connected | reconnecting | disconnected
  const [connReason, setConnReason] = useState('');

  // ====== 참조 ======
  const clientRef = useRef(null);
  const myUserIdRef = useRef(genUUID());
  const myNicknameRef = useRef(() => {
    const suffix = myUserIdRef.current.split('-')[0].slice(-4);
    return `user-${suffix}`;
  });
  if (typeof myNicknameRef.current === 'function') {
    myNicknameRef.current = myNicknameRef.current();
  }
  const presenceKeyRef = useRef(getPresenceKey());
  const seenIdsRef = useRef(new Set());        // 서버 메시지 dedup
  const sysSeqRef = useRef(0);                 // 시스템 메시지 정렬 보조
  const isColdStartRef = useRef(true);         // 초기 800ms 억제
  const everConnectedRef = useRef(false);      // 최초 연결 여부
  const lastReconnectAtRef = useRef(0);        // 재연결 쿨다운
  const connectingAnnouncedRef = useRef(false);// "연결 시도" 1회만
  const recentSysMapRef = useRef(new Map());   // content 기반 3초 dedup

  // ====== 유틸 ======
  /** createdAt > clientSentAt, 동률 시 seq로 안정 정렬 */
  const sortByTimestamp = useCallback((list) => {
    const toTs = (m) => {
      const v = Date.parse(m?.createdAt ?? m?.clientSentAt ?? 0);
      return Number.isFinite(v) ? v : 0;
    };
    const next = [...list];
    next.sort((a, b) => {
      const dt = toTs(a) - toTs(b);
      if (dt !== 0) return dt;
      const sa = Number.isFinite(a?.seq) ? a.seq : 0;
      const sb = Number.isFinite(b?.seq) ? b.seq : 0;
      return sa - sb;
    });
    return next;
  }, []);

  /** 시스템 메시지 푸시 (최근 3초 동일 문구 dedup) */
  const pushSystemMessage = useCallback((text) => {
    const now = Date.now();
    // 3초 내 동일 문구면 스킵
    const last = recentSysMapRef.current.get(text) || 0;
    if (now - last < 3000) return;
    recentSysMapRef.current.set(text, now);

    const id = `system-${now}-${sysSeqRef.current}`;
    const seq = sysSeqRef.current++;
    setMessages((prev) =>
      sortByTimestamp([
        ...prev,
        {
          id,
          seq,
          sender: 'SYSTEM',
          content: text,
          createdAt: new Date().toISOString(),
          system: true,
        },
      ])
    );
  }, [sortByTimestamp]);

  /** Presence 카운트 REST 보정 */
  const syncPresence = useCallback(() => {
    const base = import.meta.env?.VITE_API_BASE || '';
    return fetch(`${base}/api/presence/count`, { method: 'GET', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (typeof data?.count === 'number') setPresenceCount(data.count);
      })
      .catch(() => {});
  }, []);

  /** 공통: 재연결 트리거(상태 가드+쿨다운+콜드스타트 억제) */
  const triggerReconnect = useCallback((reasonText, withMessage = true) => {
    const now = Date.now();

    // 콜드스타트 800ms 억제
    if (isColdStartRef.current) return;

    // 이미 연결/연결 시도 중이면 스킵
    if (connStatus === 'connecting' || connStatus === 'connected') return;

    // 500ms 내 중복 트리거 억제
    if (now - lastReconnectAtRef.current < 500) return;
    lastReconnectAtRef.current = now;

    setConnStatus('reconnecting');
    setConnReason(reasonText);
    if (withMessage && everConnectedRef.current) {
      pushSystemMessage(reasonText);
    }

    ensureActivate(clientRef.current);
    // presence 보정
    syncPresence();
    setTimeout(syncPresence, 200);
  }, [connStatus, pushSystemMessage, syncPresence]);

  /** 보임/포커스/온라인 등에서 재연결 */
  useEffect(() => {
    // 콜드스타트 타이머 가동
    const t = setTimeout(() => { isColdStartRef.current = false; }, 800);

    const onVisibleMaybeReconnect = () => {
      // 페이지가 보이는 경우만
      if (document.visibilityState !== 'visible') return;
      // 최초 연결 전이면 안내 메시지 생략 (실제 복귀 상황이 아님)
      if (!everConnectedRef.current) return;
      triggerReconnect('백그라운드에서 복귀하여 재연결 중입니다.');
    };

    const onPageShow = () => {
      // bfcache 포함. 최초 연결 전이면 메시지 생략
      if (!everConnectedRef.current) return;
      triggerReconnect('페이지 복귀로 재연결 중입니다.');
    };

    const onFocus = () => {
      if (!everConnectedRef.current) return;
      triggerReconnect('포커스 복귀로 재연결 중입니다.', false); // 메시지 중복 줄이기
    };

    const onOnline = () => {
      triggerReconnect('네트워크가 온라인으로 전환되어 재연결 중입니다.');
    };

    document.addEventListener('visibilitychange', onVisibleMaybeReconnect);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);

    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisibleMaybeReconnect);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
    };
  }, [triggerReconnect]);

  // ====== STOMP 클라이언트 수명주기 ======
  useEffect(() => {
    const base = import.meta.env?.VITE_API_BASE || '';
    const wsUrl = `${base}/ws-sockjs`;

    setConnStatus('connecting');
    setConnReason('');
    if (!connectingAnnouncedRef.current) {
      connectingAnnouncedRef.current = true;
      pushSystemMessage('서버에 연결을 시도합니다.');
    }

    const client = new Client({
      webSocketFactory: () => new SockJS(wsUrl),
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 0,
      connectHeaders: {
        'presence-key': presenceKeyRef.current,
      },
      // debug: console.log,
      onConnect: () => {
        setConnStatus('connected');
        setConnReason('');
        everConnectedRef.current = true;
        pushSystemMessage('서버와 연결되었습니다.');

        // /topic/presence 구독
        client.subscribe('/topic/presence', (msg) => {
          try {
            const body = JSON.parse(msg.body);
            if (typeof body?.count === 'number') setPresenceCount(body.count);
          } catch {}
        });

        // /topic/public 구독
        client.subscribe('/topic/public', (msg) => {
          try {
            const body = JSON.parse(msg.body);
            const id = body?.id;
            if (id && seenIdsRef.current.has(id)) return;
            if (id) seenIdsRef.current.add(id);
            setMessages((prev) => sortByTimestamp([...prev, body]));
          } catch {}
        });

        // REST 보정
        syncPresence();
        setTimeout(syncPresence, 200);
      },
      onStompError: (frame) => {
        setConnStatus('reconnecting');
        const msg = frame?.headers?.message || 'broker error';
        setConnReason(msg);
        if (everConnectedRef.current) {
          pushSystemMessage(`브로커 오류로 재연결 중입니다.${frame?.headers?.message ? ` (${frame.headers.message})` : ''}`);
        }
      },
      onWebSocketError: () => {
        setConnStatus('reconnecting');
        setConnReason('websocket error');
        if (everConnectedRef.current) {
          pushSystemMessage('웹소켓 오류로 재연결 중입니다.');
        }
      },
      onWebSocketClose: (ev) => {
        setConnStatus('reconnecting');
        setConnReason(`socket closed${ev?.code ? ` (code ${ev.code})` : ''}`);
        if (everConnectedRef.current) {
          pushSystemMessage(`연결이 종료되어 재연결 중입니다.${ev?.code ? ` (code ${ev.code})` : ''}`);
        }
        // reconnectDelay에 따라 자동 재시도
      },
    });

    clientRef.current = client;
    ensureActivate(client);

    return () => {
      // 언마운트 시 메시지 출력하지 않음(새로고침/라우트 전환에서 혼선 방지)
      client.deactivate();
      clientRef.current = null;
      setConnStatus('disconnected');
      setConnReason('component unmounted');
    };
  }, [sortByTimestamp, syncPresence, pushSystemMessage]);

  // ====== 송신 API ======
  const send = useCallback((text) => {
    const client = clientRef.current;
    if (!client || !client.connected) {
      setConnStatus('reconnecting');
      setConnReason('send requested while disconnected');
      // 최초 연결 전이면 시스템 메시지 생략
      if (everConnectedRef.current) {
        pushSystemMessage('연결이 없어 메시지를 전송할 수 없습니다. 재연결 중입니다.');
      }
      ensureActivate(client);
      return;
    }
    const payload = {
      userId: myUserIdRef.current,
      sender: myNicknameRef.current,
      content: text,
      clientSentAt: new Date().toISOString(),
    };
    client.publish({ destination: '/app/chat.send', body: JSON.stringify(payload) });
  }, [pushSystemMessage]);

  // ====== 나의 메타 ======
  const my = useMemo(
    () => ({ userId: myUserIdRef.current, nickname: myNicknameRef.current }),
    []
  );

  // ====== 반환 ======
  return useMemo(
    () => ({ messages, send, my, presenceCount, connStatus, connReason }),
    [messages, send, my, presenceCount, connStatus, connReason]
  );
}
