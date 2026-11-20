import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 3000,
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
  },
});
