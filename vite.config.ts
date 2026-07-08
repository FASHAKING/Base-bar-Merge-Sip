import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
  },
});
