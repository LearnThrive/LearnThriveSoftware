import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { DEV_TUNNEL_HOST_SUFFIXES } from '@learnthrive/shared/allowedHosts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      // Vite's leading-dot syntax allows any subdomain of that suffix — covers Cloudflare Quick
      // Tunnel and Tailscale's randomly-generated hostnames with no per-session .env edit.
      // TUNNEL_HOST remains available for a stable named domain (see README).
      allowedHosts: [...DEV_TUNNEL_HOST_SUFFIXES, ...(env.TUNNEL_HOST ? [env.TUNNEL_HOST] : [])],
      proxy: {
        '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
        // Temporary Cloudflare TURN credential generation (see server/signalling.ts) — same
        // same-origin-through-Vite pattern as /socket.io above, so one HTTPS tunnel covers both.
        '/api': { target: 'http://127.0.0.1:3001' },
      },
    },
  };
});
