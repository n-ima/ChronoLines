// 起動・配線・listen（server-api.md 1〜2章）。ルート・起動シーケンスの本体は api.ts にあり、
// ここは実環境の値（データディレクトリ・ポート・dist/client・アプリ版数）を配線して
// 127.0.0.1 で listen するだけに保つ（統合テストは api.ts を直接使う）。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp, initializeContext } from './api';
import { resolveDataDir } from './storage';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// /api/health の appVersion は package.json の version を正とする（版数を二重管理しない）
const pkg = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8')) as {
  version?: string;
};

const context = await initializeContext({
  dataDir: resolveDataDir(),
  appVersion: pkg.version ?? '0.0.0',
});

const app = createApp(context, path.join(rootDir, 'dist', 'client'));

const port = Number(process.env['CHRONOLINES_PORT'] ?? 5177);

// NFR: 外部に開かない。listen は 127.0.0.1 固定（stack-conventions）
const server = app.listen(port, '127.0.0.1', () => {
  // 起動成功時、コンソールに URL・データファイルパスを表示する（server-api.md 2章 手順4）
  console.log(`ChronoLines server: http://127.0.0.1:${port}`);
  console.log(`データファイル: ${context.dataPath}`);
  if (context.status.state !== 'ok') {
    // 起動自体は継続する（リカバリはブラウザの画面経由。server-api.md 3章 / US-010）
    console.warn(
      `保存データの状態: ${context.status.state}。ブラウザでリカバリ画面の案内に従ってください`,
    );
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // メッセージ文言は server-api.md 2章のとおり（ADR 0001 の劣化時の受け皿）
    console.error(
      `ポート${port}が使用中です。CHRONOLINES_PORT で変更するか、既存の ChronoLines を終了してください`,
    );
    process.exit(1);
  }
  throw err;
});
