// 핵심 변경점:
// - connectHeaders에 persistent presenceKey 전송(localStorage 기반)
// - heartbeatOutgoing=0, heartbeatIncoming=10000 (서버는 클라 하트비트 기대 안 함)
// - visibilitychange: 포그라운드 복귀 즉시 재동기화/재연결 보정
// - onConnect 후 presence 구독 -> REST 재동기화(2회) 유지

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs.min.js';

function genUUID() {
  return globalThis.crypto?.randomUUID?.()
    || `uid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 지속 키: 브라우저(설치된 앱 아님) 단위로 유지
function getPresenceKey() {
  try {
    const k = localStorage.getItem('presenceKey');
    if (k) return k;
    const nk = genUUID();
    localStorage.setItem('presenceKey', nk);
    return nk;
  } catch {
    // 프라이버시 모드 등 localStorage 불가 시 메모리 폴백
    return genUUID();
  }
}

export function useStompChat() {
  const [messages, setMessages] = useState([]);
  const [presenceCount, setPresenceCount] = useState(0);
  const [connStatus, setConnStatus] = useState('connecting');
  const [connReason, setConnReason] = useState('');

  const clientRef = useRef(null);
  const myUserIdRef = useRef(genUUID()); // 탭 생애주기용
  const myNicknameRef = useRef(() => {
    const suffix = myUserIdRef.current.split('-')[0].slice(-4);
    return `user-${suffix}`;
  });
  if (typeof myNicknameRef.current === 'function') {
    myNicknameRef.current = myNicknameRef.current();
  }

  const presenceKeyRef = useRef(getPresenceKey());

  const sortByTimestamp = useCallback((list) => {
    const next = [...list];
    next.sort((a, b) => {
      const ta = Date.parse(a?.createdAt ?? a?.clientSentAt ?? 0);
      const tb = Date.parse(b?.createdAt ?? b?.clientSentAt ?? 0);
      return ta - tb;
    });
    return next;
  }, []);

  const syncPresence = useCallback(() => {
    const base = import.meta.env?.VITE_API_BASE || '';
    return fetch(`${base}/api/presence/count`, { method: 'GET', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (typeof data?.count === 'number') setPresenceCount(data.count);
      })
      .catch(() => {});
  }, []);

  // 가시성 전환: 포그라운드 복귀 시 즉시 보정
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        // 소켓이 죽었으면 재시도, 살아있어도 값 보정
        syncPresence();
        setTimeout(syncPresence, 200);
        const c = clientRef.current;
        if (c && !c.connected && c.active) {
          // @stomp/stompjs는 활성 상태면 자동 재시도 중. 필요 시 강제 재시도 트리거:
          try { c.deactivate().then(() => c.activate()); } catch {}
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [syncPresence]);

  useEffect(() => {
    const base = import.meta.env?.VITE_API_BASE || '';
    const wsUrl = `${base}/ws-sockjs`;

    setConnStatus('connecting');
    setConnReason('');

    const socket = new SockJS(wsUrl);
    const client = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000,
      // 서버가 클라이언트 하트비트를 기대하지 않게 함 → 백그라운드 종료 완화
      heartbeatIncoming: 10000, // 서버 → 클라
      heartbeatOutgoing: 0,     // 클라 → 서버 (0으로 협상)
      connectHeaders: {
        // 서버 ChannelInterceptor에서 읽어 프레즌스 그레이스에 사용
        'presence-key': presenceKeyRef.current,
      },
      // debug: console.log,
    });

    client.onConnect = () => {
      setConnStatus('connected');
      setConnReason('');

      client.subscribe('/topic/presence', (msg) => {
        try {
          const body = JSON.parse(msg.body);
          if (typeof body?.count === 'number') setPresenceCount(body.count);
        } catch {}
      });

      client.subscribe('/topic/public', (msg) => {
        try {
          const body = JSON.parse(msg.body);
          setMessages((prev) => sortByTimestamp([...prev, body]));
        } catch {}
      });

      // 선택: 입장 알림
      try {
        client.publish({
          destination: '/app/chat.join',
          body: JSON.stringify({
            userId: myUserIdRef.current,
            sender: myNicknameRef.current,
            content: '',
          }),
        });
      } catch {}

      // 구독 직후 현재값 보정
      syncPresence();
      setTimeout(syncPresence, 200);
    };

    client.onStompError = (frame) => {
      setConnStatus('reconnecting');
      setConnReason(frame?.headers?.message || 'broker error');
    };
    client.onWebSocketError = () => {
      setConnStatus('reconnecting');
      setConnReason('websocket error');
    };
    client.onWebSocketClose = (ev) => {
      setConnStatus('reconnecting');
      setConnReason(`code ${ev?.code || ''}`);
    };

    client.activate();
    clientRef.current = client;

    return () => {
      client.deactivate();
      clientRef.current = null;
      setConnStatus('disconnected');
    };
  }, [sortByTimestamp, syncPresence]);

  const send = useCallback((text) => {
    const client = clientRef.current;
    if (!client || !client.connected) return;
    const payload = {
      userId: myUserIdRef.current,
      sender: myNicknameRef.current,
      content: text,
      clientSentAt: new Date().toISOString(),
    };
    client.publish({ destination: '/app/chat.send', body: JSON.stringify(payload) });
  }, []);

  const my = useMemo(
    () => ({ userId: myUserIdRef.current, nickname: myNicknameRef.current }),
    []
  );

  return useMemo(
    () => ({ messages, send, my, presenceCount, connStatus, connReason }),
    [messages, send, my, presenceCount, connStatus, connReason]
  );
}
