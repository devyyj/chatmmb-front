// src/hooks/useStompChat.js
// 목적: 새로고침 시 실제 접속자 수와 일치하도록
// - /topic/presence 구독 직후 REST 재동기화(syncPresence) 2회 호출(즉시 + 200ms 보정)
// - 연결 상태(connected/connecting/reconnecting/disconnected) 노출 유지
// - 메시지 정렬(createdAt > clientSentAt) 유지

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs.min.js';

function genUUID() {
  return globalThis.crypto?.randomUUID?.()
    || `uid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useStompChat() {
  // 메시지 / 접속자 수 / 연결 상태
  const [messages, setMessages] = useState([]);
  const [presenceCount, setPresenceCount] = useState(0);
  const [connStatus, setConnStatus] = useState('connecting');
  const [connReason, setConnReason] = useState('');

  // STOMP 클라이언트 및 탭 생애주기(LTT) 식별자
  const clientRef = useRef(null);
  const myUserIdRef = useRef(genUUID());
  const myNicknameRef = useRef(() => {
    const suffix = myUserIdRef.current.split('-')[0].slice(-4);
    return `user-${suffix}`;
  });
  if (typeof myNicknameRef.current === 'function') {
    myNicknameRef.current = myNicknameRef.current();
  }

  // 메시지 정렬: 서버 createdAt 우선, 없으면 clientSentAt
  const sortByTimestamp = useCallback((list) => {
    const next = [...list];
    next.sort((a, b) => {
      const ta = Date.parse(a?.createdAt ?? a?.clientSentAt ?? 0);
      const tb = Date.parse(b?.createdAt ?? b?.clientSentAt ?? 0);
      return ta - tb;
    });
    return next;
  }, []);

  // 구독 직후 현재 presence를 REST로 동기화(놓친 브로드캐스트 보정)
  const syncPresence = useCallback(() => {
    const base = import.meta.env?.VITE_API_BASE || '';
    return fetch(`${base}/api/presence/count`, { method: 'GET', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (typeof data?.count === 'number') setPresenceCount(data.count);
      })
      .catch(() => {
        // 네트워크/CORS 실패는 무시(브로드캐스트로 자연 보정)
      });
  }, []);

  // STOMP 연결/구독
  useEffect(() => {
    const base = import.meta.env?.VITE_API_BASE || '';
    const wsUrl = `${base}/ws-sockjs`;

    setConnStatus('connecting');
    setConnReason('');

    const socket = new SockJS(wsUrl);
    const client = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000, // 자동 재연결
      // debug: console.log,
    });

    client.onConnect = () => {
      setConnStatus('connected');
      setConnReason('');

      // 1) presence 먼저 구독
      client.subscribe('/topic/presence', (msg) => {
        try {
          const body = JSON.parse(msg.body);
          if (typeof body?.count === 'number') setPresenceCount(body.count);
        } catch {
          // ignore
        }
      });

      // 2) 메시지 채널 구독
      client.subscribe('/topic/public', (msg) => {
        try {
          const body = JSON.parse(msg.body);
          setMessages((prev) => sortByTimestamp([...prev, body]));
        } catch {
          // ignore
        }
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
      } catch {
        // endpoint 미구현 시 무시
      }

      // 3) 구독 직후 REST로 현재값 재동기화(놓친 브로드캐스트 보정)
      syncPresence();
      setTimeout(syncPresence, 200); // 브로커 이벤트 지연 레이스 보정
    };

    // 오류/닫힘 → 재연결 상태 전환
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

  // 발신
  const send = useCallback((text) => {
    const client = clientRef.current;
    if (!client || !client.connected) return;

    const payload = {
      userId: myUserIdRef.current,
      sender: myNicknameRef.current,
      content: text,
      clientSentAt: new Date().toISOString(),
    };

    client.publish({
      destination: '/app/chat.send',
      body: JSON.stringify(payload),
    });
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
