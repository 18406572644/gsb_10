import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 开发环境把 /ws 代理到协同服务端
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
