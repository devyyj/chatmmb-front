// hooks/useStompChat.js
// 목적: 모바일에서 앱 전환(백그라운드) 후 브라우저로 복귀 시 STOMP 자동 재연결
// 변경 사항 요약
// - pageshow/visibilitychange/focus/online 이벤트에서 즉시 재연결 트리거
// - onWebSocketClose 시 상태를 reconnecting으로 표기
// - 송신 전에 연결 상태 보호(미연결 시 재연결 유도)
// - presence 보정(REST) 즉시+200ms 2회 호출 유지
// - heartbeat: incoming=10s, outgoing=0 (서버 설정과 합치)
// - reconnectDelay=5000ms (필요 시 지수백오프로 확장 가능)

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
  // @stomp/stompjs v7: active=true면 이미 activate() 호출된 상태
  if (!client.active) client.activate();
}

export function useStompChat() {
  // ====== 상태 ======
  const [messages, setMessages] = useState([]);
  const [presenceCount, setPresenceCount] = useState(0);
  const [connStatus, setConnStatus] = useState('connecting');   // connecting | connected | reconnecting | disconnected
  const [connReason, setConnReason] = useState('');             // 상태 툴팁에 표시

  // ====== 참조 ======
  const clientRef = useRef(null);
  const myUserIdRef = useRef(genUUID()); // 탭 생애주기 기준 식별자
  const myNicknameRef = useRef(() => {
    const suffix = myUserIdRef.current.split('-')[0].slice(-4);
    return `user-${suffix}`;
  });
  if (typeof myNicknameRef.current === 'function') {
    myNicknameRef.current = myNicknameRef.current();
  }
  const presenceKeyRef = useRef(getPresenceKey());
  const seenIdsRef = useRef(new Set()); // 중복 메시지 방지(id 기반)

  // ====== 유틸 ======
  /** createdAt > clientSentAt 순으로 정렬, 파싱 실패 안전 처리 */
  const sortByTimestamp = useCallback((list) => {
    const toTs = (m) => {
      const v = Date.parse(m?.createdAt ?? m?.clientSentAt ?? 0);
      return Number.isFinite(v) ? v : 0;
    };
    const next = [...list];
    next.sort((a, b) => toTs(a) - toTs(b));
    return next;
  }, []);

  /** Presence 카운트 REST 보정 (즉시/200ms 딜레이 2회 호출에 사용) */
  const syncPresence = useCallback(() => {
    const base = import.meta.env?.VITE_API_BASE || '';
    return fetch(`${base}/api/presence/count`, { method: 'GET', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (typeof data?.count === 'number') setPresenceCount(data.count);
      })
      .catch(() => {});
  }, []);

  /** 브라우저가 다시 보이거나(focus/pageshow) 온라인 복귀 시 재연결 */
  useEffect(() => {
    const onVisibleMaybeReconnect = () => {
      if (document.visibilityState !== 'visible') return;

      // Presence 값 보정 2회(즉시 + 200ms)
      syncPresence();
      setTimeout(syncPresence, 200);

      const c = clientRef.current;
      // 연결이 죽었거나 active=false 이면 즉시 재연결 시도
      if (!c?.connected || !c?.active) {
        setConnStatus('reconnecting');
        setConnReason('resuming from background');
        ensureActivate(c);
      }
    };

    // iOS Safari: bfcache 복귀 케이스
    const onPageShow = (e) => {
      if (e.persisted) onVisibleMaybeReconnect();
      else onVisibleMaybeReconnect();
    };

    const onFocus = () => onVisibleMaybeReconnect();
    const onOnline = () => {
      setConnStatus('reconnecting');
      setConnReason('network online');
      ensureActivate(clientRef.current);
      // 온라인 전환 시에도 존재 카운트 보정
      syncPresence();
      setTimeout(syncPresence, 200);
    };

    document.addEventListener('visibilitychange', onVisibleMaybeReconnect);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibleMaybeReconnect);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
    };
  }, [syncPresence]);

  // ====== STOMP 클라이언트 수명주기 ======
  useEffect(() => {
    const base = import.meta.env?.VITE_API_BASE || '';
    const wsUrl = `${base}/ws-sockjs`;

    setConnStatus('connecting');
    setConnReason('');

    const client = new Client({
      webSocketFactory: () => new SockJS(wsUrl),
      reconnectDelay: 5000,           // 고정 5s (필요 시 지수백오프+지터 가능)
      heartbeatIncoming: 10000,       // 서버 → 클라이언트 (서버 설정과 일치)
      heartbeatOutgoing: 0,           // 클라 → 서버 비활성(백그라운드 종료 완화)
      connectHeaders: {
        'presence-key': presenceKeyRef.current, // 서버의 presence grace 취소용 헤더
      },
      // debug: console.log,
      onConnect: () => {
        setConnStatus('connected');
        setConnReason('');

        // /topic/presence 구독: 카운트 갱신
        client.subscribe('/topic/presence', (msg) => {
          try {
            const body = JSON.parse(msg.body);
            if (typeof body?.count === 'number') setPresenceCount(body.count);
          } catch {}
        });

        // /topic/public 구독: 메시지 수신
        client.subscribe('/topic/public', (msg) => {
          try {
            const body = JSON.parse(msg.body);
            // id 기반 dedup (서버가 동일 메시지 재전달/재연결 시)
            const id = body?.id;
            if (id && seenIdsRef.current.has(id)) return;
            if (id) seenIdsRef.current.add(id);
            setMessages((prev) => sortByTimestamp([...prev, body]));
          } catch {}
        });

        // 구독 직후 REST 보정 2회
        syncPresence();
        setTimeout(syncPresence, 200);
      },
      onStompError: (frame) => {
        setConnStatus('reconnecting');
        setConnReason(frame?.headers?.message || 'broker error');
      },
      onWebSocketError: () => {
        setConnStatus('reconnecting');
        setConnReason('websocket error');
      },
      onWebSocketClose: (ev) => {
        // 모바일 백그라운드 전환 시 주로 발생
        setConnStatus('reconnecting');
        setConnReason(`socket closed${ev?.code ? ` (code ${ev.code})` : ''}`);
        // reconnectDelay에 따라 자동 재시도
      },
    });

    clientRef.current = client;
    ensureActivate(client); // 최초 연결 시도

    return () => {
      client.deactivate();
      clientRef.current = null;
      setConnStatus('disconnected');
    };
  }, [sortByTimestamp, syncPresence]);

  // ====== 송신 API ======
  const send = useCallback((text) => {
    const client = clientRef.current;
    // 연결이 없으면 사용자를 기다리게 하지 말고 즉시 재연결 시도
    if (!client || !client.connected) {
      setConnStatus('reconnecting');
      setConnReason('send requested while disconnected');
      ensureActivate(client);
      return; // 낙관적 UI가 없다면 보류
    }
    const payload = {
      userId: myUserIdRef.current,
      sender: myNicknameRef.current,
      content: text,
      clientSentAt: new Date().toISOString(),
    };
    client.publish({ destination: '/app/chat.send', body: JSON.stringify(payload) });
  }, []);

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
