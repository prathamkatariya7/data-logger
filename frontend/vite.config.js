import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build outputs to frontend/dist, which the Express server serves statically.
// During dev, `npm run dev` proxies /api and /socket.io to the Node server on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
