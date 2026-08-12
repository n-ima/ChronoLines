// 本番相当のローカル起動（npm start）: dist/client が無ければ build してから、
// tsx でサーバー（src/server/index.ts）を起動する（stack-conventions の npm scripts 表）。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distIndex = path.join(root, 'dist', 'client', 'index.html');

if (!existsSync(distIndex)) {
  console.log('dist/client が見つからないため、先にビルドします...');
  const build = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) {
    console.error('ビルドに失敗したため起動を中止します。');
    process.exit(build.status ?? 1);
  }
}

const server = spawnSync('npx tsx src/server/index.ts', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
process.exit(server.status ?? 0);
