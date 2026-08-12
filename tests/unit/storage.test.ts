// TASK-006: storage.ts の単体テスト（server-api.md 2章・4章 / ADR 0002）。
// 完了条件: CHRONOLINES_DATA_DIR で指した一時ディレクトリを使い、初回生成・
// 書き込み後の .bak 生成・rename 後の本体整合・corrupt 改名保全を検証する。
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadStore } from '../../src/domain/migrate';
import { CURRENT_SCHEMA_VERSION, storeSchema, type Store } from '../../src/domain/schema';
import {
  ensureDataDir,
  preserveCorruptFile,
  resolveDataDir,
  storeFilePath,
  writeStoreFile,
} from '../../src/server/storage';

// ---- ヘルパー: storeSchema.parse を通した正規の Store を作る（年ブランド型のため） ----

const makeStore = (timelineName: string): Store =>
  storeSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeTimelineId: 'tl_1',
    timelines: [
      {
        id: 'tl_1',
        name: timelineName,
        persons: [],
        events: [],
        sortMode: 'birthAsc',
        personOrder: [],
        view: { startYear: null, endYear: null, zoom: 'year' },
      },
    ],
  });

// 各テストは実 OS の一時領域に独立ディレクトリを作り、終了時に必ず片付ける
let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'chronolines-storage-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ---- データディレクトリ決定（server-api.md 2章 手順1） ----

describe('resolveDataDir: データディレクトリの決定順', () => {
  it('CHRONOLINES_DATA_DIR が設定されていれば最優先でそのまま返す', () => {
    const env = { CHRONOLINES_DATA_DIR: tmpRoot, LOCALAPPDATA: 'C:\\ignored' };
    expect(resolveDataDir(env, 'win32', 'C:\\Users\\test')).toBe(tmpRoot);
  });

  it('CHRONOLINES_DATA_DIR が空白のみなら未設定として扱う', () => {
    const env = { CHRONOLINES_DATA_DIR: '  ', LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' };
    expect(resolveDataDir(env, 'win32', 'C:\\Users\\test')).toBe(
      path.join('C:\\Users\\test\\AppData\\Local', 'ChronoLines'),
    );
  });

  it('Windows: 未設定なら %LOCALAPPDATA%\\ChronoLines', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' };
    expect(resolveDataDir(env, 'win32', 'C:\\Users\\test')).toBe(
      path.join('C:\\Users\\test\\AppData\\Local', 'ChronoLines'),
    );
  });

  it('Windows: LOCALAPPDATA も無ければホーム配下の AppData\\Local に倒す', () => {
    expect(resolveDataDir({}, 'win32', 'C:\\Users\\test')).toBe(
      path.join('C:\\Users\\test', 'AppData', 'Local', 'ChronoLines'),
    );
  });

  it('Windows 以外: ~/.local/share/chronolines', () => {
    expect(resolveDataDir({}, 'linux', '/home/test')).toBe(
      path.join('/home/test', '.local', 'share', 'chronolines'),
    );
  });
});

// ---- 初回生成（ディレクトリ作成 + 本体のみ生成。.bak/.tmp は残らない） ----

describe('初回生成: ファイル不在からの writeStoreFile', () => {
  it('存在しないディレクトリを ensureDataDir が作成し、初回書き込みで本体だけができる', async () => {
    // CHRONOLINES_DATA_DIR 指定の経路で、未作成のサブディレクトリを指す
    const dataDir = resolveDataDir({ CHRONOLINES_DATA_DIR: path.join(tmpRoot, 'data') });
    await ensureDataDir(dataDir);
    expect((await stat(dataDir)).isDirectory()).toBe(true);

    await writeStoreFile(dataDir, makeStore('年表1'));

    // 本体のみ（初回は既存本体が無いので .bak は作られない。.tmp は rename 済みで残らない）
    expect((await readdir(dataDir)).sort()).toEqual(['chronolines.json']);
  });

  it('ensureDataDir は既存ディレクトリに対して冪等（エラーにならない）', async () => {
    await ensureDataDir(tmpRoot);
    await ensureDataDir(tmpRoot);
    expect((await stat(tmpRoot)).isDirectory()).toBe(true);
  });
});

// ---- 書き込み後の .bak 生成（1世代バックアップ） ----

describe('.bak 生成: 2回目以降の書き込みで直前の正常版が残る', () => {
  it('2回目の書き込みで .bak ができ、内容は直前版と一致する', async () => {
    const first = makeStore('第1版');
    const second = makeStore('第2版');
    await writeStoreFile(tmpRoot, first);
    await writeStoreFile(tmpRoot, second);

    expect((await readdir(tmpRoot)).sort()).toEqual([
      'chronolines.json',
      'chronolines.json.bak',
    ]);
    const bak = await readFile(path.join(tmpRoot, 'chronolines.json.bak'), 'utf8');
    expect(JSON.parse(bak)).toEqual(first);
  });

  it('3回目の書き込みで .bak は上書きされる（保持は常に1世代のみ）', async () => {
    await writeStoreFile(tmpRoot, makeStore('第1版'));
    await writeStoreFile(tmpRoot, makeStore('第2版'));
    await writeStoreFile(tmpRoot, makeStore('第3版'));

    const bak = await readFile(path.join(tmpRoot, 'chronolines.json.bak'), 'utf8');
    expect(JSON.parse(bak)).toEqual(makeStore('第2版'));
    expect((await readdir(tmpRoot)).sort()).toEqual([
      'chronolines.json',
      'chronolines.json.bak',
    ]);
  });
});

// ---- rename 後の本体整合（書いたものが loadStore で完全に読み戻せる） ----

describe('rename 後の本体整合', () => {
  it('書き込んだ本体は loadStore で ok と判定され、内容が入力と一致する', async () => {
    const store = makeStore('整合検証');
    await writeStoreFile(tmpRoot, store);

    const raw = await readFile(storeFilePath(tmpRoot), 'utf8');
    const result = loadStore(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.store).toEqual(store);
  });

  it('前回異常終了の残骸（stale な .tmp）があっても新しい書き込みで消費され本体は正しい', async () => {
    // tmp 書き込み後・rename 前にプロセスが落ちたケースを模す
    await writeFile(path.join(tmpRoot, 'chronolines.json.tmp'), '{ 中途半端な残骸', 'utf8');

    const store = makeStore('復旧後');
    await writeStoreFile(tmpRoot, store);

    expect((await readdir(tmpRoot)).sort()).toEqual(['chronolines.json']);
    const result = loadStore(await readFile(storeFilePath(tmpRoot), 'utf8'));
    expect(result.ok).toBe(true);
  });

  it('本体は人間が読める整形済みJSON（末尾改行つき）で書かれる', async () => {
    await writeStoreFile(tmpRoot, makeStore('整形'));
    const raw = await readFile(storeFilePath(tmpRoot), 'utf8');
    expect(raw.startsWith('{\n  "schemaVersion"')).toBe(true);
    expect(raw.endsWith('\n')).toBe(true);
  });
});

// ---- corrupt 改名保全（黙って捨てない。ADR 0002） ----

describe('corrupt 改名保全: preserveCorruptFile', () => {
  const brokenContent = '{ これはJSONではない';

  it('本体を chronolines.corrupt-<YYYYMMDD-HHmmss>.json へ改名し、内容を保全する', async () => {
    await writeFile(storeFilePath(tmpRoot), brokenContent, 'utf8');

    const preserved = await preserveCorruptFile(
      tmpRoot,
      new Date(2026, 7, 12, 9, 5, 3), // 2026-08-12 09:05:03（ローカル時刻）
    );

    expect(path.basename(preserved)).toBe('chronolines.corrupt-20260812-090503.json');
    expect(await readFile(preserved, 'utf8')).toBe(brokenContent); // 内容は一切変えない
    // 元の本体は消えている（rename = 移動。コピーではない）
    await expect(stat(storeFilePath(tmpRoot))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('同一秒内の再保全でも既存の保全ファイルを上書きしない（付番で回避）', async () => {
    const when = new Date(2026, 7, 12, 9, 5, 3);
    await writeFile(storeFilePath(tmpRoot), brokenContent, 'utf8');
    const first = await preserveCorruptFile(tmpRoot, when);

    await writeFile(storeFilePath(tmpRoot), '別の破損内容', 'utf8');
    const second = await preserveCorruptFile(tmpRoot, when);

    expect(path.basename(second)).toBe('chronolines.corrupt-20260812-090503-2.json');
    expect(await readFile(first, 'utf8')).toBe(brokenContent); // 1つ目は無傷のまま
    expect(await readFile(second, 'utf8')).toBe('別の破損内容');
  });

  it('本体が存在しないのに呼ばれたら ENOENT で明示的に失敗する（黙って成功にしない）', async () => {
    await expect(preserveCorruptFile(tmpRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
