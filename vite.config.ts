import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = Number(process.env.CODEM_BACKEND_PORT ?? process.env.PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
