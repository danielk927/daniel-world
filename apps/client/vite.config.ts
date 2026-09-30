import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    // three.js is ~580 kB minified on its own; it is lazy-loaded after the landing UI.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        portfolio: resolve(import.meta.dirname, 'portfolio.html'),
      },
    },
  },
});
