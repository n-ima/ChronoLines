// TASK-007: サーバー本体の統合テスト（server-api.md 2〜3章）。
// エフェメラルポート（listen 0）+ 一時データディレクトリで実サーバーを起動し、
// 状態×操作の表（ok/corrupt/newer × GET/PUT）・rev 楽観ロック・recovery 時の
// rev 照合スキップと改名保全・検証失敗 E-VALIDATION を HTTP 越しに実測する。
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, storeSchema, type Store } from '../../src/domain/schema';
import { createApp, initializeContext, type ServerContext } from '../../src/server/api';
import { storeFilePath } from '../../src/server/storage';

// ---- ヘルパー ----

// PUT で送る素の入力（サーバー側で storeSchema 検証される）
const makeStoreInput = (timelineName: string): Record<string, unknown> => ({
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

const makeStore = (timelineName: string): Store => storeSchema.parse(makeStoreInput(timelineName));

// 参照整合性違反（E-STORE-EVENT-ORPHAN）を含む入力
const orphanStoreInput = (): Record<string, unknown> => {
  const input = makeStoreInput('孤児イベント');
  (input['timelines'] as Record<string, unknown>[])[0]!['events'] = [
    { id: 'e_1', name: '孤児', year: 1600, tags: [], personId: 'p_missing' },
  ];
  return input;
};

const BROKEN_JSON = '{ これはJSONではない';
const NEWER_FILE = `${JSON.stringify({ schemaVersion: 2, futureField: true }, null, 2)}\n`;

let tmpRoot: string;
const servers: Server[] = [];

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'chronolines-api-'));
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
          // fetch の keep-alive 接続が close を待たせないよう明示的に切る
          server.closeAllConnections();
        }),
    ),
  );
  await rm(tmpRoot, { recursive: true, force: true });
});

async function startServer(options?: {
  dataDir?: string;
  clientDir?: string;
}): Promise<{ context: ServerContext; baseUrl: string; dataDir: string }> {
  const dataDir = options?.dataDir ?? path.join(tmpRoot, 'data');
  const context = await initializeContext({ dataDir, appVersion: '0.0.0-test' });
  const app = createApp(context, options?.clientDir ?? path.join(tmpRoot, 'client-not-built'));
  const server = await new Promise<Server>((resolve, reject) => {
    // エフェメラルポート: 0 を指定して OS に空きポートを割り当てさせる
    const s = app.listen(0, '127.0.0.1', () => {
      resolve(s);
    });
    s.on('error', reject);
  });
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { context, baseUrl: `http://127.0.0.1:${port}`, dataDir };
}

async function seedFile(dataDir: string, content: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'chronolines.json'), content, 'utf8');
}

const getStore = (baseUrl: string): Promise<Response> => fetch(`${baseUrl}/api/store`);

const putStore = (baseUrl: string, body: unknown): Promise<Response> =>
  fetch(`${baseUrl}/api/store`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

// ---- 起動シーケンス（server-api.md 2章） ----

describe('起動シーケンス', () => {
  it('ファイル不在: 初期ストア「年表1」を生成して書き込み、state=ok で起動する', async () => {
    const { context, baseUrl, dataDir } = await startServer();
    expect(context.status.state).toBe('ok');

    // ファイルが実際に生成され、スキーマ検証を通る内容である
    const onDisk = storeSchema.parse(JSON.parse(await readFile(storeFilePath(dataDir), 'utf8')));
    expect(onDisk.timelines[0]?.name).toBe('年表1');
    expect(onDisk.activeTimelineId).toBe(onDisk.timelines[0]?.id);

    const res = await getStore(baseUrl);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rev).toBe(1);
    expect(json.store.timelines[0].name).toBe('年表1');
  });

  it('正常ファイルあり: その内容を state=ok で読み込み、ファイルは書き換えない', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    await seedFile(dataDir, JSON.stringify(makeStore('既存の年表')));
    const { baseUrl } = await startServer({ dataDir });

    const json = await (await getStore(baseUrl)).json();
    expect(json.rev).toBe(1);
    expect(json.store.timelines[0].name).toBe('既存の年表');
    // 書き戻しをしていない証拠: .bak も .tmp もできていない
    expect((await readdir(dataDir)).sort()).toEqual(['chronolines.json']);
  });

  it('移行あり: 元ファイルを chronolines.v<旧版>.bak にコピー保全してから移行後データを書き戻す', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    const oldRaw = '{"schemaVersion":0,"legacy":true}';
    await seedFile(dataDir, oldRaw);

    // 現行 v1 は移行登録簿が空で実ファイルから移行分岐を作れないため、load を注入して固定する
    const migrated = makeStore('移行後');
    const context = await initializeContext({ dataDir, appVersion: '0.0.0-test' }, () => ({
      ok: true,
      store: migrated,
      migratedFrom: 0,
    }));

    expect(context.status.state).toBe('ok');
    // 旧版ファイルが chronolines.v0.bak に無傷で保全されている
    expect(await readFile(path.join(dataDir, 'chronolines.v0.bak'), 'utf8')).toBe(oldRaw);
    // 本体は移行後データに書き戻されている
    const onDisk = storeSchema.parse(JSON.parse(await readFile(storeFilePath(dataDir), 'utf8')));
    expect(onDisk).toEqual(migrated);
  });

  it('破損ファイル: state=corrupt になり、ファイルには一切触らない', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    await seedFile(dataDir, BROKEN_JSON);
    const { context } = await startServer({ dataDir });

    expect(context.status.state).toBe('corrupt');
    expect(await readFile(storeFilePath(dataDir), 'utf8')).toBe(BROKEN_JSON);
    expect((await readdir(dataDir)).sort()).toEqual(['chronolines.json']);
  });

  it('新版ファイル: state=newer になり、ファイルには一切触らない', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    await seedFile(dataDir, NEWER_FILE);
    const { context } = await startServer({ dataDir });

    expect(context.status).toEqual({ state: 'newer', fileVersion: 2 });
    expect(await readFile(storeFilePath(dataDir), 'utf8')).toBe(NEWER_FILE);
  });
});

// ---- GET /api/store（状態×操作の表） ----

describe('GET /api/store', () => {
  it('state=corrupt: 409 E-STORE-CORRUPT（message・detail・dataPath つき）', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    await seedFile(dataDir, BROKEN_JSON);
    const { baseUrl } = await startServer({ dataDir });

    const res = await getStore(baseUrl);
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error.code).toBe('E-STORE-CORRUPT');
    expect(error.message).toBe('保存データを読み込めませんでした');
    expect(typeof error.detail).toBe('string');
    expect(error.detail.length).toBeGreaterThan(0);
    expect(error.dataPath).toBe(storeFilePath(dataDir));
  });

  it('state=newer: 409 E-STORE-NEWER（fileVersion・appSchemaVersion・dataPath つき）', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    await seedFile(dataDir, NEWER_FILE);
    const { baseUrl } = await startServer({ dataDir });

    const res = await getStore(baseUrl);
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error.code).toBe('E-STORE-NEWER');
    expect(error.message).toBe('より新しいバージョンのアプリで保存されたデータです');
    expect(error.fileVersion).toBe(2);
    expect(error.appSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(error.dataPath).toBe(storeFilePath(dataDir));
  });
});

// ---- GET /api/health ----

describe('GET /api/health', () => {
  it('state=ok: ok/appVersion/schemaVersion/dataPath/state を返す', async () => {
    const { baseUrl, dataDir } = await startServer();
    const json = await (await fetch(`${baseUrl}/api/health`)).json();
    expect(json).toEqual({
      ok: true,
      appVersion: '0.0.0-test',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      dataPath: storeFilePath(dataDir),
      state: 'ok',
    });
  });

  it('state=corrupt / newer もそのまま state に反映される', async () => {
    const corruptDir = path.join(tmpRoot, 'corrupt');
    await seedFile(corruptDir, BROKEN_JSON);
    const corrupt = await startServer({ dataDir: corruptDir });
    expect((await (await fetch(`${corrupt.baseUrl}/api/health`)).json()).state).toBe('corrupt');

    const newerDir = path.join(tmpRoot, 'newer');
    await seedFile(newerDir, NEWER_FILE);
    const newer = await startServer({ dataDir: newerDir });
    expect((await (await fetch(`${newer.baseUrl}/api/health`)).json()).state).toBe('newer');
  });
});

// ---- PUT /api/store: state=ok ----

describe('PUT /api/store（state=ok）', () => {
  it('正しい rev: 200 で rev がインクリメントされ、メモリとファイルが更新され .bak に直前版が残る', async () => {
    const { baseUrl, dataDir } = await startServer();

    const res = await putStore(baseUrl, { rev: 1, store: makeStoreInput('第2版'), recovery: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rev: 2 });

    // メモリ（GET はメモリから返す）
    const after = await (await getStore(baseUrl)).json();
    expect(after.rev).toBe(2);
    expect(after.store.timelines[0].name).toBe('第2版');

    // ファイルと1世代バックアップ
    const onDisk = storeSchema.parse(JSON.parse(await readFile(storeFilePath(dataDir), 'utf8')));
    expect(onDisk.timelines[0]?.name).toBe('第2版');
    const bak = JSON.parse(await readFile(path.join(dataDir, 'chronolines.json.bak'), 'utf8'));
    expect(bak.timelines[0].name).toBe('年表1');
  });

  it('rev 不一致: 409 E-REV-CONFLICT（currentRev つき）でメモリ・ファイルとも無変更', async () => {
    const { baseUrl, dataDir } = await startServer();

    const res = await putStore(baseUrl, { rev: 99, store: makeStoreInput('侵入版') });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: 'E-REV-CONFLICT', currentRev: 1 });

    const after = await (await getStore(baseUrl)).json();
    expect(after.rev).toBe(1);
    expect(after.store.timelines[0].name).toBe('年表1');
    const onDisk = storeSchema.parse(JSON.parse(await readFile(storeFilePath(dataDir), 'utf8')));
    expect(onDisk.timelines[0]?.name).toBe('年表1');
  });

  it('recovery:true は state=ok でも rev 照合をスキップして書き込む', async () => {
    const { baseUrl } = await startServer();

    const res = await putStore(baseUrl, {
      rev: 999, // 不一致だが recovery なので照合されない
      store: makeStoreInput('リカバリ上書き'),
      recovery: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rev: 2 });
  });

  it('検証失敗（参照整合性違反）: 400 E-VALIDATION（detail に issue 一覧）で無変更', async () => {
    const { baseUrl } = await startServer();

    const res = await putStore(baseUrl, { rev: 1, store: orphanStoreInput() });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe('E-VALIDATION');
    expect(Array.isArray(error.detail)).toBe(true);
    expect(error.detail.join(' ')).toContain('E-STORE-EVENT-ORPHAN');

    const after = await (await getStore(baseUrl)).json();
    expect(after.rev).toBe(1);
    expect(after.store.timelines[0].name).toBe('年表1');
  });

  it('store が欠けたリクエスト: 400 E-VALIDATION', async () => {
    const { baseUrl } = await startServer();
    const res = await putStore(baseUrl, { rev: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('E-VALIDATION');
  });

  it('JSONとして解釈できないボディ: 400 E-VALIDATION', async () => {
    const { baseUrl } = await startServer();
    const res = await putStore(baseUrl, '{ broken json');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('E-VALIDATION');
  });

  it('同一 rev の同時 PUT は直列化され、成功するのは1件だけ（多重タブ検出）', async () => {
    const { baseUrl } = await startServer();

    const [a, b] = await Promise.all([
      putStore(baseUrl, { rev: 1, store: makeStoreInput('タブA') }),
      putStore(baseUrl, { rev: 1, store: makeStoreInput('タブB') }),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await loser.json()).error.code).toBe('E-REV-CONFLICT');

    const after = await (await getStore(baseUrl)).json();
    expect(after.rev).toBe(2);
    expect(['タブA', 'タブB']).toContain(after.store.timelines[0].name);
  });

  it('既定の100KBを超える大きなボディ（約2MB）も受け付ける（上限50MB）', async () => {
    const { baseUrl } = await startServer();

    const note = 'x'.repeat(2000);
    const input = makeStoreInput('大量データ');
    (input['timelines'] as Record<string, unknown>[])[0]!['events'] = Array.from(
      { length: 1200 },
      (_, i) => ({ id: `e_${i}`, name: `イベント${i}`, year: 1600, note, tags: [] }),
    );
    const body = { rev: 1, store: input };
    expect(JSON.stringify(body).length).toBeGreaterThan(2_000_000);

    const res = await putStore(baseUrl, body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rev: 2 });
  });

  it('書き込み失敗: 500 E-SAVE-FAILED でメモリは書き込み前の状態を維持する', async () => {
    const { baseUrl, dataDir } = await startServer();
    // データディレクトリを消して原子的書き込みを OS エラーで失敗させる
    await rm(dataDir, { recursive: true, force: true });

    const res = await putStore(baseUrl, { rev: 1, store: makeStoreInput('保存失敗版') });
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error.code).toBe('E-SAVE-FAILED');
    expect(error.message).toBe('保存に失敗しました');
    expect(typeof error.detail).toBe('string');

    // メモリ・rev は書き込み前のまま
    const after = await (await getStore(baseUrl)).json();
    expect(after.rev).toBe(1);
    expect(after.store.timelines[0].name).toBe('年表1');
  });
});

// ---- PUT /api/store: state=corrupt ----

describe('PUT /api/store（state=corrupt）', () => {
  it('recovery 無し: 409 E-NEEDS-RECOVERY で破損ファイルは無変更', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    await seedFile(dataDir, BROKEN_JSON);
    const { baseUrl } = await startServer({ dataDir });

    const res = await putStore(baseUrl, { rev: 1, store: makeStoreInput('無断書き込み') });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('E-NEEDS-RECOVERY');
    expect(await readFile(storeFilePath(dataDir), 'utf8')).toBe(BROKEN_JSON);
  });

  it('recovery:true: rev 照合をスキップして書き込み、破損ファイルは chronolines.corrupt-*.json へ改名保全される', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    await seedFile(dataDir, BROKEN_JSON);
    const { baseUrl } = await startServer({ dataDir });

    // rev を送らない（corrupt に rev は無い = 照合スキップの実証）
    const res = await putStore(baseUrl, { store: makeStoreInput('復旧版'), recovery: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rev: 2 });

    // 破損ファイルが改名保全され、内容は無傷（黙って捨てない。ADR 0002）
    const files = (await readdir(dataDir)).sort();
    const preserved = files.filter((f) => /^chronolines\.corrupt-\d{8}-\d{6}(-\d+)?\.json$/.test(f));
    expect(preserved).toHaveLength(1);
    expect(await readFile(path.join(dataDir, preserved[0]!), 'utf8')).toBe(BROKEN_JSON);

    // 本体は復旧版になり、以後は ok 状態
    const onDisk = storeSchema.parse(JSON.parse(await readFile(storeFilePath(dataDir), 'utf8')));
    expect(onDisk.timelines[0]?.name).toBe('復旧版');
    expect((await (await fetch(`${baseUrl}/api/health`)).json()).state).toBe('ok');
    const after = await (await getStore(baseUrl)).json();
    expect(after.store.timelines[0].name).toBe('復旧版');
  });

  it('recovery でも検証失敗なら 400 で、破損ファイルは改名保全されない（保全より検証が先）', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    await seedFile(dataDir, BROKEN_JSON);
    const { baseUrl } = await startServer({ dataDir });

    const res = await putStore(baseUrl, { store: orphanStoreInput(), recovery: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('E-VALIDATION');

    expect((await readdir(dataDir)).sort()).toEqual(['chronolines.json']);
    expect(await readFile(storeFilePath(dataDir), 'utf8')).toBe(BROKEN_JSON);
  });
});

// ---- PUT /api/store: state=newer ----

describe('PUT /api/store（state=newer）', () => {
  it('recovery:true でも無条件で 409 E-STORE-NEWER、ファイルはバイト単位で無変更（US-010）', async () => {
    const dataDir = path.join(tmpRoot, 'data');
    await seedFile(dataDir, NEWER_FILE);
    const { baseUrl } = await startServer({ dataDir });

    const res = await putStore(baseUrl, { rev: 1, store: makeStoreInput('上書き試行'), recovery: true });
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error.code).toBe('E-STORE-NEWER');
    expect(error.fileVersion).toBe(2);
    expect(error.appSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    expect(await readFile(storeFilePath(dataDir), 'utf8')).toBe(NEWER_FILE);
    expect((await readdir(dataDir)).sort()).toEqual(['chronolines.json']);
  });
});

// ---- 静的配信 + index.html フォールバック ----

describe('静的配信と index.html フォールバック', () => {
  it('dist あり: / と未知パスは index.html、実在アセットはその内容を返す', async () => {
    const clientDir = path.join(tmpRoot, 'client');
    await mkdir(path.join(clientDir, 'assets'), { recursive: true });
    await writeFile(
      path.join(clientDir, 'index.html'),
      '<!doctype html><div id="root">ChronoLines SPA</div>',
      'utf8',
    );
    await writeFile(path.join(clientDir, 'assets', 'app.js'), 'console.log("chronolines-app");', 'utf8');
    const { baseUrl } = await startServer({ clientDir });

    const root = await fetch(`${baseUrl}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('ChronoLines SPA');

    const asset = await fetch(`${baseUrl}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('chronolines-app');

    // SPA の画面ルート（未知パス）は index.html にフォールバック
    const spa = await fetch(`${baseUrl}/timelines/some-route`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('ChronoLines SPA');
  });

  it('/api の未知パスはフォールバックせず 404 を返す', async () => {
    const clientDir = path.join(tmpRoot, 'client');
    await mkdir(clientDir, { recursive: true });
    await writeFile(path.join(clientDir, 'index.html'), '<!doctype html>SPA', 'utf8');
    const { baseUrl } = await startServer({ clientDir });

    const res = await fetch(`${baseUrl}/api/unknown-route`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('SPA');
  });

  it('dist 無し: 404 とビルド案内メッセージを返す（黙って空を返さない）', async () => {
    const { baseUrl } = await startServer();
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('dist/client');
  });
});
