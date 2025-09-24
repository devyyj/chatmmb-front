// components/MessageList.jsx
// 내 메시지 판정은 훅에서 내려준 my.userId/nickname 기준(세션 저장소 사용 안 함)
// 시스템 메시지(system: true)는 중앙 정렬, 희미한 안내 스타일로 렌더링
import React, { useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { Virtuoso } from 'react-virtuoso';

/**
 * props:
 * - messages: 수신된 메시지 배열
 * - timeFormatter: Intl.DateTimeFormat(HH:mm:ss)
 * - my: { userId, nickname }  // useStompChat()에서 전달
 */
export default function MessageList({ messages, timeFormatter, my }) {
  // 내 메시지 판정: userId 우선, 없으면 sender 보조
  const isMine = useCallback(
    (m) => (m?.userId && m.userId === my.userId) || (m?.sender && m.sender === my.nickname),
    [my]
  );

  const itemContent = useCallback(
    (index) => {
      const m = messages[index];

      // ===== 시스템 메시지 처리 =====
      if (m?.system) {
        const displayedAtIso = m?.createdAt ?? m?.clientSentAt;
        const displayedAt = displayedAtIso ? new Date(displayedAtIso) : null;
        const timeText = displayedAt ? timeFormatter.format(displayedAt) : null;
        return (
          <Box sx={{ px: 2, py: 0.5, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box
              sx={{
                maxWidth: '80%',
                bgcolor: 'grey.100',
                color: 'text.secondary',
                px: 1.5,
                py: 0.5,
                borderRadius: 1,
                boxShadow: 0,
                border: '1px dashed',
                borderColor: 'grey.300',
                textAlign: 'center',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}
            >
              <Typography variant="caption">{m?.content ?? ''}</Typography>
              {timeText && (
                <Typography variant="caption" sx={{ opacity: 0.85, display: 'block', textAlign: 'right', mt: 0.3 }}>
                  {timeText}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }

      // ===== 일반 메시지 처리 =====
      const mine = isMine(m);
      const displayedAtIso = m?.createdAt ?? m?.clientSentAt;
      const displayedAt = displayedAtIso ? new Date(displayedAtIso) : null;
      const timeText = displayedAt ? timeFormatter.format(displayedAt) : null;

      return (
        <Box sx={{ px: 2, py: 0.5, display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
          {!mine && (
            <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.3 }}>
              {m?.sender ?? 'Unknown'}
            </Typography>
          )}
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
            {timeText && (
              <Typography variant="caption" sx={{ opacity: 0.85, display: 'block', textAlign: 'right', mt: 0.5 }}>
                {timeText}
              </Typography>
            )}
          </Box>
        </Box>
      );
    },
    [messages, isMine, timeFormatter]
  );

  return (
    <Box sx={{ flex: 1, borderBottom: '1px solid #eee', py: 2 }}>
      <Virtuoso
        data={messages}
        totalCount={messages.length}
        itemContent={itemContent}
        followOutput="auto"
        style={{ height: '100%' }}
      />
    </Box>
  );
}
