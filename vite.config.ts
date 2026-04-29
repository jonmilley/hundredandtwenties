import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  root: '.',
  server: { port: 5173, open: false },
  test: {
    globals: true,
    environment: 'node',
  },
});
