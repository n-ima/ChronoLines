/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// アプリ版数の正は package.json の version（server/index.ts と同じ方針。二重管理しない）。
// クライアントへは __APP_VERSION__ 定数としてビルド時に埋め込む（エクスポートの appVersion 用）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
  },
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
