// TASK-001 時点の最小スケルトン（npm run dev / npm start がサーバーを起動できるようにするため）。
// API（/api/store, /api/health)・静的配信・起動シーケンスの本実装は TASK-007（server-api.md）。
import express from 'express';

const port = Number(process.env['CHRONOLINES_PORT'] ?? 5177);
const app = express();

// NFR: 外部に開かない。listen は 127.0.0.1 固定（stack-conventions）
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`ChronoLines server: http://127.0.0.1:${port}`);
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
