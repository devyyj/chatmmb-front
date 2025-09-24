// 헤더 우측에 상태 Chip 출력(연결됨/재연결 중/끊김)
// 필요 시 Alert로 교체해도 무방
import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Box, Paper, Typography, Chip, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import InputBar from '../components/InputBar';
import MessageList from '../components/MessageList';
import { useStompChat } from '../hooks/useStompChat';
import { formatHMS } from '../utils/time';

export default function ChatPage() {
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  const { messages, send, my, presenceCount, connStatus, connReason } = useStompChat();

  const timeFormatter = useMemo(() => formatHMS(), []);
  const onSend = useCallback(() => {
    const text = input.trim();
    if (!text) return inputRef.current?.focus();
    send(text);
    setInput('');
    inputRef.current?.focus();
  }, [input, send]);

  const theme = useTheme();
  const upMd = useMediaQuery(theme.breakpoints.up('md'));
  const upSm = useMediaQuery(theme.breakpoints.up('sm'));
  const logoHeight = upMd ? 64 : upSm ? 48 : 36;

  const statusUi = useMemo(() => {
    switch (connStatus) {
      case 'connected':   return { color: 'success', label: '연결됨' };
      case 'connecting':  return { color: 'info',    label: '연결 중' };
      case 'reconnecting':return { color: 'warning', label: '재연결 중' };
      case 'disconnected':
      default:            return { color: 'error',   label: '연결 끊김' };
    }
  }, [connStatus]);

  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="#f5f5f5" px={2}>
      <Paper elevation={3} sx={{ width: 'min(92vw, 520px)', height: 'min(86vh, 720px)', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더: 로고 중앙 + 접속자 수/상태 우측 */}
        <Box sx={{ p: 2, borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center' }}>
          <Box sx={{ flex: 1 }} />
          <img src="/android-chrome-192x192.png" alt="Logo" style={{ height: logoHeight, width: 'auto', display: 'block' }} />
          <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              현재 접속자 {presenceCount}명
            </Typography>
            <Tooltip title={connReason || ''} arrow disableHoverListener={!connReason}>
              <Chip size="small" color={statusUi.color} label={statusUi.label} />
            </Tooltip>
          </Box>
        </Box>

        <MessageList messages={messages} timeFormatter={timeFormatter} my={my} />

        <InputBar value={input} onChange={setInput} onEnter={onSend} onSend={onSend} inputRef={inputRef} />
      </Paper>
    </Box>
  );
}
