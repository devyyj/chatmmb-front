import React, { useEffect, useState, useRef } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';

function App() {
  const [messages, setMessages] = useState([]);
  const [client, setClient] = useState(null);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    // WebSocket 연결
    const socket = new SockJS(`${import.meta.env.VITE_API_BASE}/ws-sockjs`); // 서버 endpoint
    const stompClient = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000,
    });

    stompClient.onConnect = () => {
      // 구독
      stompClient.subscribe('/topic/public', (msg) => {
        const body = JSON.parse(msg.body);
        setMessages((prev) => [...prev, body]);
      });
    };

    stompClient.activate();
    setClient(stompClient);

    return () => {
      stompClient.deactivate();
    };
  }, []);

  const sendMessage = () => {
    if (client && input.trim() !== '') {
      client.publish({
        destination: '/app/chat.send', // 서버 ChatController 매핑
        body: JSON.stringify({
          sender: 'Guest',
          content: input,
        }),
      });
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="#f5f5f5"
    >
      <Paper elevation={3} sx={{ width: 400, height: 600, display: 'flex', flexDirection: 'column' }}>
        <Typography
          variant="h6"
          align="center"
          sx={{ p: 2, borderBottom: '1px solid #ddd' }}
        >
          실시간 채팅방
        </Typography>

        <Box flex={1} overflow="auto" p={2}>
          <List>
            {messages.map((m, idx) => (
              <ListItem key={idx}>
                <ListItemText primary={`${m.sender}: ${m.content}`} />
              </ListItem>
            ))}
            <div ref={messagesEndRef} />
          </List>
        </Box>

        <Box display="flex" p={2} borderTop="1px solid #ddd">
          <TextField
            fullWidth
            variant="outlined"
            size="small"
            placeholder="메시지를 입력하세요..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button variant="contained" sx={{ ml: 1 }} onClick={sendMessage}>
            전송
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

export default App;
