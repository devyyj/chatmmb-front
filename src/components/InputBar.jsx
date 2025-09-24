// 입력창 컴포넌트: 리스트 리렌더 영향 최소화를 위해 memo
import React, { useCallback } from 'react';
import { Box, Button, TextField } from '@mui/material';

const InputBar = React.memo(function InputBar({ value, onChange, onEnter, onSend, inputRef }) {
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

export default InputBar;
