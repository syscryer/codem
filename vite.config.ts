import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = Number(process.env.CODEM_BACKEND_PORT ?? process.env.PORT ?? 3001);
const mobileCompanionPort = Number(process.env.CODEM_MOBILE_COMPANION_PORT ?? 3210);
const webPort = Number(process.env.CODEM_WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
    proxy: {
      // 注意顺序：/api/mobile-companion 管理路由属于主后端，必须排在 /api/mobile 网关代理之前
      '/api/mobile-companion': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
      // 移动伴侣网关路由（认证、任务、引导数据）只挂在伴侣监听器上，需单独代理；
      // 不能改写 Host：网关会校验 Origin 与 Host 一致，changeOrigin 会导致“请求来源不受信任”
      '/api/mobile': {
        target: `http://127.0.0.1:${mobileCompanionPort}`,
      },
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
