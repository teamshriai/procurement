import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is fully static. Serve it at the site root by default, or under a sub-path by building with
//   VITE_BASE=/dev/procurement/ npm run build
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // also reachable from other computers on the network
  },
});
