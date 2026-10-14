import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined;
          if (['/react/', '/react-dom/', '/scheduler/'].some((part) => id.includes(part))) return 'react-vendor';
          if (['/@tanstack/', '/zustand/', '/zod/'].some((part) => id.includes(part))) return 'data-vendor';
          if (id.includes('/@radix-ui/')) return 'ui-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
});
