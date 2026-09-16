import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      allowedHosts: env.TUNNEL_HOST ? [env.TUNNEL_HOST] : [],
      proxy: { '/socket.io': { target: 'http://127.0.0.1:3001', ws: true } },
    },
  };
});
