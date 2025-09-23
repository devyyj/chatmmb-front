import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// globalThis를 global로 매핑
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
})