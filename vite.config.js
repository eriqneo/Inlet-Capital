import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    target: 'esnext'
  },
  // Ensure Vite maps the existing public directory correctly
  publicDir: 'public',
});
