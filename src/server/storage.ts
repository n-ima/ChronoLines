// 保存ファイルのデータディレクトリ決定・原子的書き込み・バックアップ・破損保全
// （server-api.md 2章・4章 / ADR 0002）。サーバー層のファイルI/O専任モジュール。
// ドメイン層（src/domain/）は純粋に保つため、fs を触るコードはサーバー層に閉じる。
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Store } from '../domain/schema';

const STORE_FILE = 'chronolines.json';
const TMP_FILE = 'chronolines.json.tmp';
const BAK_FILE = 'chronolines.json.bak';

// データディレクトリの決定（server-api.md 2章の手順1）:
// CHRONOLINES_DATA_DIR → %LOCALAPPDATA%\ChronoLines（Windows）→ ~/.local/share/chronolines。
// env/platform/home を引数で受けるのはテストで分岐を固定するため（既定は実環境）。
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const fromEnv = env['CHRONOLINES_DATA_DIR'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv;
  }
  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'];
    // LOCALAPPDATA 未設定は通常起こらないが、その場合も既定の実体パスと同じ場所に倒す
    const base =
      localAppData !== undefined && localAppData.trim() !== ''
        ? localAppData
        : path.join(home, 'AppData', 'Local');
    return path.join(base, 'ChronoLines');
  }
  return path.join(home, '.local', 'share', 'chronolines');
}

// データディレクトリが無ければ作成する（server-api.md 2章の手順1「無ければ作成」）
export async function ensureDataDir(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
}

// 本体ファイルのパス（起動ログ・/api/health の dataPath 表示にも使う）
export function storeFilePath(dataDir: string): string {
  return path.join(dataDir, STORE_FILE);
}

// 原子的書き込み（server-api.md 4章の3手順そのまま）。
// どの段階で失敗しても本体は「直前の正常版」か「新版」のどちらかに保たれる。
// 失敗（ディスク満杯・権限等）はそのまま throw する（E-SAVE-FAILED への変換は API 層の責務。
// 握りつぶすと「保存できていないのに保存済みに見える」状態を作るため、ここでは隠さない）。
export async function writeStoreFile(dataDir: string, store: Store): Promise<void> {
  const storePath = storeFilePath(dataDir);
  const tmpPath = path.join(dataDir, TMP_FILE);
  const bakPath = path.join(dataDir, BAK_FILE);

  // 1. tmp に全量を書き込み fsync（プロセス強制終了・電源断が tmp 段階なら本体は無傷）
  //    整形は2スペース: 人間が直接読める・コピーできるのが単一JSONの採用理由の一つ（ADR 0002）
  const json = `${JSON.stringify(store, null, 2)}\n`;
  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(json, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  // 2. 既存本体があれば .bak へコピー（1世代。手動復旧用でアプリは自動では読まない）
  //    ENOENT（初回生成 = 既存本体なし）だけを正常扱いし、他のエラーは隠さず throw
  try {
    await fs.copyFile(storePath, bakPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  // 3. 同一ボリューム内 rename = 原子的置き換え
  await fs.rename(tmpPath, storePath);
}

// 破損ファイルの改名保全（server-api.md 3章の手順5 / ADR 0002「黙って捨てない」）。
// リカバリ書き込みの直前に呼び、読めなかった本体を chronolines.corrupt-<YYYYMMDD-HHmmss>.json
// へ退避する。保全後のパスを返す（リカバリ画面での提示用）。
// 本体が存在しない呼び出しは呼び出し側の状態管理の誤りなので ENOENT をそのまま throw する。
export async function preserveCorruptFile(
  dataDir: string,
  now: Date = new Date(),
): Promise<string> {
  const storePath = storeFilePath(dataDir);
  const stamp = formatTimestamp(now);

  // Windows の fs.rename は既存ターゲットを黙って上書きするため、同一秒内の再保全でも
  // 以前の保全ファイルを失わないよう空き名を明示的に探す（-2, -3, ... を付番）
  let target = path.join(dataDir, `chronolines.corrupt-${stamp}.json`);
  for (let n = 2; await fileExists(target); n += 1) {
    target = path.join(dataDir, `chronolines.corrupt-${stamp}-${n}.json`);
  }

  await fs.rename(storePath, target);
  return target;
}

// ローカル時刻の YYYYMMDD-HHmmss（ユーザーがエクスプローラーで見つける用途のため UTC にしない）
function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${ymd}-${hms}`;
}

// 存在確認。ENOENT のみ「無い」と判定し、権限エラー等は隠さず throw する
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
