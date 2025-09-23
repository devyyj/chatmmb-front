// src/App.jsx
// 요구사항: MUI, 반응형 로고 헤더(좌: 로고 / 중앙: 텍스트 / 우: QR), 접속 시 자동 참여, 단일 채팅방, 인증 없음
// - 환경 분기: .env.* 의 VITE_API_BASE (없으면 상대경로)
// - STOMP: onConnect 이후 publish, 자동 재연결(reconnectDelay)
// - 탭(창)별 사용자 식별: sessionStorage에 userId(UUID), nickname 저장
// - 메시지 표시: 내 메시지(본문만, 우측) / 상대 메시지("<sender>: 본문", 좌측)

import React, {useEffect, useRef, useState} from 'react';
import {Client} from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs.min.js';
import {Box, Button, List, Paper, TextField, Typography, useMediaQuery, useTheme,} from '@mui/material';

function App() {
  // 메시지 리스트
  const [messages, setMessages] = useState([]);
  // STOMP 클라이언트
  const [client, setClient] = useState(null);
  // 입력값
  const [input, setInput] = useState('');
  // 내 사용자 식별 정보 (탭/창 단위)
  const myUserIdRef = useRef(null);
  const myNicknameRef = useRef(null);

  // 스크롤 끝으로 이동 참조
  const messagesEndRef = useRef(null);

  // 반응형 로고/QR 크기
  const theme = useTheme();
  const upMd = useMediaQuery(theme.breakpoints.up('md'));
  const upSm = useMediaQuery(theme.breakpoints.up('sm'));
  const logoHeight = upMd ? 64 : upSm ? 48 : 36; // md↑:64px, sm↑:48px, xs:36px

  // 탭별 userId/nickname 초기화
  useEffect(() => {
    // 이미 존재하면 재사용
    let uid = sessionStorage.getItem('userId');
    let nick = sessionStorage.getItem('nickname');

    // 없으면 생성
    if (!uid) {
      uid = globalThis.crypto?.randomUUID?.() || `uid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('userId', uid);
    }
    if (!nick) {
      // 간단한 닉네임 생성 (예: user-3f9a)
      const suffix = uid.split('-')[0].slice(-4);
      nick = `user-${suffix}`;
      sessionStorage.setItem('nickname', nick);
    }

    myUserIdRef.current = uid;
    myNicknameRef.current = nick;
  }, []);

  // STOMP 연결
  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE || '';
    const wsUrl = `${base}/ws-sockjs`;

    const socket = new SockJS(wsUrl);
    const stompClient = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000, // 재연결(ms)
      // debug 제거(요청사항: 디버그 로그 제외)
    });

    // 연결 성공 시 구독
    stompClient.onConnect = () => {
      stompClient.subscribe('/topic/public', (msg) => {
        try {
          const body = JSON.parse(msg.body);
          setMessages((prev) => [...prev, body]);
        } catch {
          // JSON 파싱 실패 시 무시
        }
      });
    };

    stompClient.activate();
    setClient(stompClient);

    // 언마운트 시 연결 해제
    return () => {
      stompClient.deactivate();
    };
  }, []);

  // 메시지 전송
  const sendMessage = () => {
    if (!client || !client.connected) return; // onConnect 이후에만 전송
    const text = input.trim();
    if (!text) return;

    const payload = {
      userId: myUserIdRef.current, // 탭 고유 식별자
      sender: myNicknameRef.current, // 표시용 닉네임
      content: text,
    };

    client.publish({
      destination: '/app/chat.send', // 서버측 @MessageMapping("/chat.send")
      body: JSON.stringify(payload),
    });
    setInput('');
  };

  // Enter 전송 (IME 조합 중 예외)
  const handleKeyDown = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') sendMessage();
  };

  // 새 메시지 도착 시 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages]);

  // 내 메시지 판정: userId 매칭 우선, 없으면 sender 매칭 보조
  const isMine = (m) =>
    (m?.userId && m.userId === myUserIdRef.current) ||
    (m?.sender && m.sender === myNicknameRef.current);

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
        {/* 반응형 로고 헤더 */}
        <Box
          sx={{
            p: 2,
            borderBottom: '1px solid #ddd',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Box sx={{flex: 1, display: 'flex', justifyContent: 'center'}}>
            <img
              src="/android-chrome-192x192.png"
              alt="Logo"
              style={{height: logoHeight, width: 'auto', display: 'block'}}
            />
          </Box>
        </Box>

        {/* 메시지 리스트 영역 */}
        <Box flex={1} overflow="auto" p={2}>
          <List sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {messages.map((m, idx) => {
              const mine = isMine(m);
              return (
                <Box
                  key={idx}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: mine ? 'flex-end' : 'flex-start',
                  }}
                >
                  {/* 상대방 메시지: 사용자 이름 */}
                  {!mine && (
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary', mb: 0.3 }}
                    >
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
                    }}
                  >
                    <Typography variant="body2">
                      {m?.content ?? ''}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
            <div ref={messagesEndRef} />
          </List>
        </Box>


        {/* 입력영역 */}
        <Box display="flex" p={2} borderTop="1px solid #ddd" gap={1}>
          <TextField
            fullWidth
            variant="outlined"
            size="small"
            placeholder="메시지를 입력하세요..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            variant="contained"
            onClick={sendMessage}
            disabled={!input.trim()}
          >
            전송
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

export default App;
