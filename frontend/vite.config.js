import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Keep rarely-changing libraries in their own long-cacheable files.
        // pusher-js is only imported by the editor, so it stays out of the first load.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('pusher-js')) return 'realtime';
          return undefined;
        }
      }
    }
  }
});
