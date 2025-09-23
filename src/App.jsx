// App.jsx
// 입력 지연을 줄이기 위한 최적화 버전
// - 가상화 리스트(react-window)
// - 입력창/메시지 아이템 메모화
// - 수신 메시지 배칭(setState 빈도 감소)
// - 자동 스크롤 최적화
// - 메시지 개수 상한(메모리/DOM 보호)

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  CircularProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { FixedSizeList as VirtualList, areEqual } from 'react-window';

// =====================================
// 상수 및 유틸
// =====================================

const MAX_MESSAGES = 1000; // 최근 N개만 유지
const BATCH_INTERVAL_MS = 80; // 수신 배칭 주기
const BATCH_MAX_PER_TICK = 50; // 한 틱에서 최대 추가 수

// 안정적 key를 위해 id가 없으면 해시 생성
const stableId = (m, idx) => m?.id ?? `${m?.timestamp ?? ''}-${idx}`;

// 최근 하단 근접 여부 판단
const isNearBottom = ({ scrollOffset, scrollHeight, clientHeight }, threshold = 120) =>
  scrollHeight - (scrollOffset + clientHeight) < threshold;

// 메시지 포맷 예시 변환기(외부 소스 다양성 대응)
// 필요한 경우, 여기서 백엔드 포맷을 통일하세요.
function normalizeMessage(raw) {
  if (!raw) return null;
  return {
    id: raw.id ?? raw._id ?? raw.uuid ?? undefined,
    role: raw.role ?? raw.author ?? 'user',
    text: raw.text ?? raw.content ?? '',
    timestamp: raw.timestamp ?? raw.createdAt ?? Date.now(),
  };
}

// =====================================
// 메시지 아이템(메모화)
// =====================================

const MessageItem = React.memo(function MessageItem({ data, index, style }) {
  // react-window는 style을 꼭 전달해야 합니다.
  const m = data.messages[index];
  if (!m) return null;
  const mine = m.role === 'user';

  return (
    <Box style={style} sx={{ px: 1.5, py: 0.75 }}>
      <Paper
        elevation={0}
        variant="outlined"
        sx={{
          display: 'inline-block',
          maxWidth: '75%',
          px: 1.5,
          py: 1,
          borderRadius: 2,
          borderColor: mine ? 'primary.light' : 'grey.300',
          bgcolor: mine ? 'primary.50' : 'background.paper',
          float: mine ? 'right' : 'left',
          clear: 'both',
        }}
      >
        <Typography
          variant="body2"
          sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {m.text}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {new Date(m.timestamp).toLocaleTimeString()}
        </Typography>
      </Paper>
    </Box>
  );
}, areEqual);

// =====================================
// 입력 바(메모화)
// =====================================

const InputBar = React.memo(function InputBar({
                                                disabled,
                                                onSend,
                                                placeholder = '메시지를 입력하세요…',
                                              }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  const handleChange = useCallback((e) => setValue(e.target.value), []);
  const handleSend = useCallback(() => {
    const v = value.trim();
    if (!v) return;
    onSend(v);
    setValue('');
    // 입력 후 포커스 유지
    inputRef.current?.focus();
  }, [onSend, value]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <Box sx={{ display: 'flex', gap: 1, p: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <TextField
        fullWidth
        inputRef={inputRef}
        size="small"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <IconButton onClick={handleSend} disabled={disabled || !value.trim()} aria-label="send">
        <SendIcon />
      </IconButton>
    </Box>
  );
});

// =====================================
// 메시지 리스트(가상 스크롤)
// =====================================

function MessageList({ messages, itemHeight = 84 }) {
  const listRef = useRef(null);
  const containerRef = useRef(null);

  // 새 메시지 도착 시 하단 근접이면 자동 스크롤
  useEffect(() => {
    const list = listRef.current?._outerRef; // react-window 내부 스크롤 엘리먼트
    if (!list) return;

    const nearBottom = isNearBottom(
      {
        scrollOffset: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
      },
      160
    );

    if (nearBottom) {
      // 대량 추가 시 성능을 위해 즉시 스크롤
      listRef.current?.scrollToItem(messages.length - 1, 'auto');
    }
  }, [messages.length]);

  const itemKey = useCallback((index, data) => {
    return stableId(data.messages[index], index);
  }, []);

  // 높이 동적 계산(헤더/입력 제외한 남은 영역)
  const [height, setHeight] = useState(480);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onResize = () => {
      const rect = el.getBoundingClientRect();
      setHeight(rect.height);
    };
    onResize();
    const obs = new ResizeObserver(onResize);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const itemData = useMemo(() => ({ messages }), [messages]);

  return (
    <Box ref={containerRef} sx={{ flex: 1, minHeight: 200 }}>
      <VirtualList
        ref={listRef}
        height={height}
        itemCount={messages.length}
        itemSize={itemHeight}
        itemData={itemData}
        itemKey={itemKey}
        width="100%"
        overscanCount={6}
      >
        {MessageItem}
      </VirtualList>
    </Box>
  );
}

// =====================================
// 메인 앱
// =====================================

export default function App() {
  // 실제 앱에서는 초기 메시지를 서버에서 받아올 수 있습니다.
  const [messages, setMessages] = useState(() => []);
  const [sending, setSending] = useState(false);

  // 수신 배칭용 큐(렌더 영향 없음)
  const incomingRef = useRef([]);
  const mountedRef = useRef(false);

  // 수신 배칭 플러시 루프
  useEffect(() => {
    mountedRef.current = true;
    const timer = setInterval(() => {
      if (!mountedRef.current) return;
      if (incomingRef.current.length === 0) return;

      // 한 틱에 최대 BATCH_MAX_PER_TICK개만 처리
      const batch = incomingRef.current.splice(0, BATCH_MAX_PER_TICK).map(normalizeMessage).filter(Boolean);
      if (batch.length === 0) return;

      setMessages((prev) => {
        const next = [...prev, ...batch];
        // 상한 유지
        if (next.length > MAX_MESSAGES) {
          return next.slice(next.length - MAX_MESSAGES);
        }
        return next;
      });
    }, BATCH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, []);

  // 예시: 서버에서 들어오는 메시지를 흉내내는 API
  const simulateIncoming = useCallback((text) => {
    // 대량 메시지도 큐에 넣고 배칭 처리
    incomingRef.current.push({
      role: 'assistant',
      text,
      timestamp: Date.now(),
    });
  }, []);

  // 전송 핸들러
  const handleSend = useCallback(async (text) => {
    const now = Date.now();
    // 1) 즉시 로컬 echo(입력 지연 최소화)
    setMessages((prev) => {
      const next = [
        ...prev,
        { role: 'user', text, timestamp: now, id: `local-${now}` },
      ];
      if (next.length > MAX_MESSAGES) return next.slice(next.length - MAX_MESSAGES);
      return next;
    });

    try {
      setSending(true);
      // 2) 서버 호출(여기서는 모의 지연)
      await new Promise((r) => setTimeout(r, 200));
      // 3) 서버 응답을 수신 큐에 적재(배칭으로 화면 반영)
      simulateIncoming(`응답: ${text}`);
    } catch (e) {
      simulateIncoming('오류가 발생했습니다. 잠시 후 다시 시도하세요.');
    } finally {
      setSending(false);
    }
  }, [simulateIncoming]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 헤더 */}
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle1">메시지</Typography>
      </Box>

      {/* 메시지 리스트(가상화) */}
      <MessageList messages={messages} itemHeight={88} />

      {/* 전송 상태 표시선(필요 시) */}
      {sending && (
        <Box sx={{ px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={16} />
          <Typography variant="caption" color="text.secondary">
            전송 중…
          </Typography>
        </Box>
      )}

      {/* 입력바(메모화) */}
      <InputBar disabled={sending} onSend={handleSend} />
    </Box>
  );
}

/*
설치:
  npm i react-window
설명:
  - react-window로 메시지 DOM을 필요한 부분만 렌더링합니다.
  - InputBar, MessageItem은 React.memo로 불필요한 재렌더를 차단합니다.
  - 들어오는 메시지는 incomingRef 큐에 쌓고 일정 주기로 배칭 반영합니다.
  - 리스트 하단 근처일 때만 자동 스크롤합니다.
  - MAX_MESSAGES로 메모리와 레이아웃 비용을 제한합니다.
연동:
  - 서버 이벤트 스트림(SSE/WebSocket)에서 수신 시: incomingRef.current.push(serverMsg)
  - serverMsg는 normalizeMessage에서 기대하는 필드로 맞춰 주십시오.
*/
