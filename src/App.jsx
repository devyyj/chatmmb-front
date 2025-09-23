// App.jsx
// React 18+, @mui/material, @stomp/stompjs, sockjs-client, react-virtuoso

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs.min.js';
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Virtuoso } from 'react-virtuoso';

// -------------------------------
// 입력창: 리스트 리렌더 영향 제거 + 전송 후 포커스 복귀
// -------------------------------
const InputBar = React.memo(function InputBar({
                                                value,
                                                onChange,
                                                onEnter,
                                                onSend,
                                                inputRef,
                                              }) {
  // IME 조합 중 Enter 무시
  const handleKeyDown = useCallback(
    (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') onEnter();
    },
    [onEnter]
  );

  return (
    <Box display="flex" p={2} borderTop="1px solid #ddd" gap={1}>
      <TextField
        fullWidth
        variant="outlined"
        size="small"
        placeholder="메시지를 입력하세요..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        inputRef={inputRef}
      />
      <Button variant="contained" onClick={onSend} disabled={!value.trim()}>
        전송
      </Button>
    </Box>
  );
});

function App() {
  // 메시지 리스트
  const [messages, setMessages] = useState([]);
  // STOMP 클라이언트
  const clientRef = useRef(null);
  // 입력값
  const [input, setInput] = useState('');
  // 입력창 포커스용 ref
  const inputRef = useRef(null);

  // 내 사용자 식별 정보 (탭/창 단위)
  const myUserIdRef = useRef(null);
  const myNicknameRef = useRef(null);

  // 반응형 로고/QR 크기
  const theme = useTheme();
  const upMd = useMediaQuery(theme.breakpoints.up('md'));
  const upSm = useMediaQuery(theme.breakpoints.up('sm'));
  const logoHeight = upMd ? 64 : upSm ? 48 : 36; // md↑:64px, sm↑:48px, xs:36px

  // 시간 포맷터(로컬 타임존, HH:mm:ss)
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    []
  );

  // 탭별 userId/nickname 초기화
  useEffect(() => {
    let uid = sessionStorage.getItem('userId');
    let nick = sessionStorage.getItem('nickname');

    if (!uid) {
      uid =
        globalThis.crypto?.randomUUID?.() ||
        `uid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('userId', uid);
    }
    if (!nick) {
      const suffix = uid.split('-')[0].slice(-4);
      nick = `user-${suffix}`;
      sessionStorage.setItem('nickname', nick);
    }

    myUserIdRef.current = uid;
    myNicknameRef.current = nick;
  }, []);

  // STOMP 연결
  useEffect(() => {
    const base = import.meta.env?.VITE_API_BASE || '';
    const wsUrl = `${base}/ws-sockjs`;

    const socket = new SockJS(wsUrl);
    const stompClient = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000, // 자동 재연결
      // debug: console.log,
    });

    stompClient.onConnect = () => {
      // 단일 방 구독
      stompClient.subscribe('/topic/public', (msg) => {
        try {
          const body = JSON.parse(msg.body);
          // createdAt > clientSentAt 기준 정렬
          setMessages((prev) => {
            const next = [...prev, body];
            next.sort((a, b) => {
              const ta = Date.parse(a?.createdAt ?? a?.clientSentAt ?? 0);
              const tb = Date.parse(b?.createdAt ?? b?.clientSentAt ?? 0);
              return ta - tb;
            });
            return next;
          });
        } catch {
          // ignore
        }
      });

      // 선택: 서버가 /app/chat.join 처리 시 입장 브로드캐스트
      try {
        const joinPayload = {
          userId: myUserIdRef.current,
          sender: myNicknameRef.current,
          content: '',
        };
        stompClient.publish({
          destination: '/app/chat.join',
          body: JSON.stringify(joinPayload),
        });
      } catch {
        // 서버 엔드포인트 없으면 무시
      }
    };

    stompClient.activate();
    clientRef.current = stompClient;

    return () => {
      stompClient.deactivate();
      clientRef.current = null;
    };
  }, []);

  // 내 메시지 판정: userId 매칭 우선, 없으면 sender 매칭 보조
  const isMine = useCallback(
    (m) =>
      (m?.userId && m.userId === myUserIdRef.current) ||
      (m?.sender && m.sender === myNicknameRef.current),
    []
  );

  // 메시지 전송
  const sendMessage = useCallback(() => {
    const client = clientRef.current;
    if (!client || !client.connected) return;

    const text = input.trim();
    if (!text) {
      // 포커스 유지
      if (inputRef.current) inputRef.current.focus();
      return;
    }

    // 클라이언트 낙관적 타임스탬프(서버 createdAt 도착 전까지 표시 대체)
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

    // 입력값 초기화 + 포커스 복귀
    setInput('');
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [input]);

  // 리스트 아이템 렌더 함수 (가상화 전용)
  const itemContent = useCallback(
    (index) => {
      const m = messages[index];
      const mine = isMine(m);
      // 표시용 시간: 서버 createdAt 우선, 없으면 clientSentAt
      const displayedAtIso = m?.createdAt ?? m?.clientSentAt;
      const displayedAt = displayedAtIso ? new Date(displayedAtIso) : null;
      const timeText = displayedAt ? timeFormatter.format(displayedAt) : null;

      return (
        <Box
          sx={{
            px: 2,
            py: 0.5,
            display: 'flex',
            flexDirection: 'column',
            alignItems: mine ? 'flex-end' : 'flex-start',
          }}
        >
          {/* 상대방 메시지: 사용자 이름만(시간은 말풍선 하단 공통 처리) */}
          {!mine && (
            <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.3 }}>
              {m?.sender ?? 'Unknown'}
            </Typography>
          )}

          {/* 말풍선 */}
          <Box
            sx={{
              maxWidth: '70%',
              bgcolor: mine ? 'primary.main' : 'grey.200',
              color: mine ? 'white' : 'black',
              px: 2,
              py: 1,
              borderRadius: 2,
              boxShadow: 1,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}
          >
            <Typography variant="body2">{m?.content ?? ''}</Typography>

            {/* 모든 메시지: 말풍선 내부 우하단에 시간 표시(HH:mm:ss) */}
            {timeText && (
              <Typography
                variant="caption"
                sx={{ opacity: 0.85, display: 'block', textAlign: 'right', mt: 0.5 }}
              >
                {timeText}
              </Typography>
            )}
          </Box>
        </Box>
      );
    },
    [messages, isMine, timeFormatter]
  );

  // Virtuoso는 itemContent가 바뀔 때만 영향. messages 길이만 의존.
  const totalCount = messages.length;

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="#f5f5f5"
      px={2}
    >
      <Paper
        elevation={3}
        sx={{
          width: 'min(92vw, 520px)',
          height: 'min(86vh, 720px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 반응형 로고 헤더 (로고만 중앙) */}
        <Box
          sx={{
            p: 2,
            borderBottom: '1px solid #ddd',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <img
            src="/android-chrome-192x192.png"
            alt="Logo"
            style={{ height: logoHeight, width: 'auto', display: 'block' }}
          />
        </Box>

        {/* 메시지 리스트 (가상 스크롤) */}
        <Box sx={{ flex: 1, borderBottom: '1px solid #eee', py: 2 }}>
          <Virtuoso
            data={messages}
            totalCount={totalCount}
            itemContent={itemContent}
            // 바닥에 있을 때만 자동 스크롤 → 입력 지연 원인 제거
            followOutput="auto"
            // 성능: overscan 기본 적절, 필요 시 increaseViewportBy 조정
            style={{ height: '100%' }}
          />
        </Box>

        {/* 입력영역 (메모화) */}
        <InputBar
          value={input}
          onChange={setInput}
          onEnter={sendMessage}
          onSend={sendMessage}
          inputRef={inputRef}
        />
      </Paper>
    </Box>
  );
}

export default App;
