/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
  },
  server: {
    port: 5173,
    // dev 時はローカルサーバー（Express, 既定5177）へ /api をプロキシする（ADR 0001）
    proxy: {
      '/api': 'http://127.0.0.1:5177',
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
});
