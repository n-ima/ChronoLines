// サーバー本体: 起動シーケンス（server-api.md 2章）と /api ルート（同3章）・静的配信（同1章）。
// アプリ生成（createApp / initializeContext）と listen（index.ts）を分離してあるのは、
// 統合テストがエフェメラルポート + 一時データディレクトリで実サーバーを起動できるようにするため。
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { ZodError } from 'zod';

import { loadStore, type LoadResult } from '../domain/migrate';
import { CURRENT_SCHEMA_VERSION, storeSchema, type Store } from '../domain/schema';
import {
  backupBeforeMigration,
  ensureDataDir,
  preserveCorruptFile,
  storeFilePath,
  writeStoreFile,
} from './storage';

// 保存データの状態（server-api.md 2章）。newer/corrupt ではメモリにストアを持たない
// （newer は以後書き込み一切禁止、corrupt はファイルに触らない。US-010）
export type StoreStatus =
  | { state: 'ok'; store: Store }
  | { state: 'corrupt'; detail: string }
  | { state: 'newer'; fileVersion: number };

// サーバーが保持する実行時状態。rev はサーバー起動単位の通し番号（初期値 1。
// PUT 成功のたびにインクリメントして返す。多重タブ検出の楽観ロックに使う）
export interface ServerContext {
  dataDir: string;
  dataPath: string;
  appVersion: string;
  rev: number;
  status: StoreStatus;
}

// 初回起動（ファイル不在）時にサーバーが生成する初期ストア（data-model.md 3章）
function createInitialStore(): Store {
  const timelineId = `tl_${randomUUID()}`;
  return storeSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeTimelineId: timelineId,
    timelines: [
      {
        id: timelineId,
        name: '年表1',
        persons: [],
        events: [],
        sortMode: 'birthAsc',
        personOrder: [],
        view: { startYear: null, endYear: null, zoom: 'year' },
      },
    ],
  });
}

// 起動シーケンスの手順1〜2（server-api.md 2章）: データディレクトリ確保 → 読み込み判定。
// load を引数で差し替えられるのは、移行分岐（migratedFrom）が現行スキーマ v1 では
// 実ファイルから作れない（移行登録簿が空）ため、テストで分岐を固定するための注入点
// （storage.ts の resolveDataDir が env/platform を引数で受けるのと同じ流儀）。
export async function initializeContext(
  options: { dataDir: string; appVersion: string },
  load: (raw: string) => LoadResult = loadStore,
): Promise<ServerContext> {
  const { dataDir, appVersion } = options;
  await ensureDataDir(dataDir);
  const dataPath = storeFilePath(dataDir);

  let raw: string | undefined;
  try {
    raw = await fs.readFile(dataPath, 'utf8');
  } catch (error) {
    // ENOENT（初回起動）のみ正常扱い。権限エラー等は起動失敗として隠さず throw
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  let status: StoreStatus;
  if (raw === undefined) {
    // ファイル不在 → 初期ストアを生成してファイルを書き、state = 'ok'
    const store = createInitialStore();
    await writeStoreFile(dataDir, store);
    status = { state: 'ok', store };
  } else {
    const result = load(raw);
    if (result.ok) {
      if (result.migratedFrom !== undefined) {
        // ok かつ移行あり → 元ファイルを chronolines.v<旧版>.bak にコピー保全してから書き戻す
        await backupBeforeMigration(dataDir, result.migratedFrom);
        await writeStoreFile(dataDir, result.store);
      }
      status = { state: 'ok', store: result.store };
    } else if (result.code === 'NEWER_SCHEMA') {
      // メモリに読み込まず、以後書き込み一切禁止（US-010）
      status = { state: 'newer', fileVersion: result.fileVersion };
    } else {
      // ファイルは触らない（US-010）
      status = { state: 'corrupt', detail: result.detail };
    }
  }

  return { dataDir, dataPath, appVersion, rev: 1, status };
}

// E-VALIDATION の detail に載せる Zod issue 一覧（全量は巨大になり得るため先頭に絞る）
const MAX_DETAIL_ISSUES = 20;

function formatIssues(error: ZodError): string[] {
  const shown = error.issues.slice(0, MAX_DETAIL_ISSUES).map((issue) => {
    const issuePath = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    return `${issuePath}: ${issue.message}`;
  });
  const rest = error.issues.length - shown.length;
  if (rest > 0) {
    shown.push(`ほか${rest}件`);
  }
  return shown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// レスポンス文言は server-api.md 3章の例・7章のエラーIDカタログのとおり
function newerErrorBody(context: ServerContext, fileVersion: number): object {
  return {
    error: {
      code: 'E-STORE-NEWER',
      message: 'より新しいバージョンのアプリで保存されたデータです',
      fileVersion,
      appSchemaVersion: CURRENT_SCHEMA_VERSION,
      dataPath: context.dataPath,
    },
  };
}

// PUT /api/store の処理本体。番号コメントは server-api.md 3章 PUT の手順番号
async function handlePut(context: ServerContext, body: unknown, res: Response): Promise<void> {
  // 1. newer は無条件拒否（recovery でも書かせない。US-010「上書きせず停止」）
  if (context.status.state === 'newer') {
    res.status(409).json(newerErrorBody(context, context.status.fileVersion));
    return;
  }

  const recovery = isRecord(body) && body['recovery'] === true;

  // 2. 破損状態でリカバリ画面を経由しない書き込みを防ぐ
  if (context.status.state === 'corrupt' && !recovery) {
    res.status(409).json({
      error: {
        code: 'E-NEEDS-RECOVERY',
        message: '破損状態でのリカバリ外書き込み',
        dataPath: context.dataPath,
      },
    });
    return;
  }

  // 3. storeSchema 厳密検証（参照整合性含む。検証は境界で行う。NFR）
  const parsed = storeSchema.safeParse(isRecord(body) ? body['store'] : undefined);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'E-VALIDATION',
        message: 'スキーマ検証失敗',
        detail: formatIssues(parsed.error),
      },
    });
    return;
  }

  // 4. rev 楽観ロック（多重タブ検出）。recovery 時は照合をスキップ
  if (context.status.state === 'ok' && !recovery) {
    const rev: unknown = isRecord(body) ? body['rev'] : undefined;
    if (rev !== context.rev) {
      res.status(409).json({ error: { code: 'E-REV-CONFLICT', currentRev: context.rev } });
      return;
    }
  }

  try {
    // 5. 破損ファイルの改名保全（黙って捨てない。ADR 0002）。検証済みの書き込みだけが通る
    if (context.status.state === 'corrupt') {
      await preserveCorruptFile(context.dataDir);
    }
    // 6. 原子的書き込み（storage.ts）
    await writeStoreFile(context.dataDir, parsed.data);
  } catch (error) {
    // メモリ（status/rev）は書き込み前の状態を維持する（server-api.md 3章 手順6）
    const detail = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      error: { code: 'E-SAVE-FAILED', message: '保存に失敗しました', detail },
    });
    return;
  }

  context.status = { state: 'ok', store: parsed.data };
  context.rev += 1;
  res.json({ rev: context.rev });
}

// express.json のボディ処理エラー（JSONでない・50MB超等）をカタログの E-VALIDATION に写像する。
// それ以外の予期しないエラーは既定のハンドラへ渡す（エラーIDカタログ外のIDを発明しない）
function bodyErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent || !isRecord(err)) {
    next(err);
    return;
  }
  const status = typeof err['status'] === 'number' ? err['status'] : undefined;
  const isBodyParserError =
    typeof err['type'] === 'string' && status !== undefined && status >= 400 && status < 500;
  if (!isBodyParserError) {
    next(err);
    return;
  }
  const message = typeof err['message'] === 'string' ? err['message'] : String(err['type']);
  res.status(status).json({
    error: {
      code: 'E-VALIDATION',
      message: 'スキーマ検証失敗',
      detail: [`リクエストボディを処理できません: ${message}`],
    },
  });
}

// アプリ本体の生成。clientDir はビルド済みSPA（dist/client）の場所
export function createApp(context: ServerContext, clientDir: string): Express {
  const app = express();

  // ボディ上限 50MB（保証スケール2MBの余裕枠。server-api.md 3章）
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/store', (_req, res) => {
    const status = context.status;
    if (status.state === 'ok') {
      res.json({ rev: context.rev, store: status.store });
      return;
    }
    if (status.state === 'corrupt') {
      res.status(409).json({
        error: {
          code: 'E-STORE-CORRUPT',
          message: '保存データを読み込めませんでした',
          detail: status.detail,
          dataPath: context.dataPath,
        },
      });
      return;
    }
    res.status(409).json(newerErrorBody(context, status.fileVersion));
  });

  // 書き込みは常に直列化キューで1件ずつ（server-api.md 3章）。前件の成否に関わらず
  // 次件を実行する（失敗の伝播でキューを止めない。各件のエラー応答は handlePut が返す）
  let tail: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = tail.then(() => task());
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  app.put('/api/store', (req, res, next) => {
    void enqueue(() => handlePut(context, req.body as unknown, res)).catch(next);
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      appVersion: context.appVersion,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      dataPath: context.dataPath,
      state: context.status.state,
    });
  });

  // /api の未知パスには index.html を返さない（フォールバックはSPAの画面ルート専用）
  app.use('/api', (_req, res) => {
    res.sendStatus(404);
  });

  const indexPath = path.join(clientDir, 'index.html');
  if (existsSync(indexPath)) {
    // ビルド済みSPAの静的配信 + 未知パスの index.html フォールバック（server-api.md 1章）
    app.use(express.static(clientDir));
    app.get('*', (_req, res) => {
      res.sendFile(indexPath);
    });
  } else {
    // dev（vite が 5173 で配信し /api だけをこちらへプロキシ）やビルド前起動では
    // dist/client が無い。黙って空を返さず、状況と対処を明示する
    app.get('*', (_req, res) => {
      res
        .status(404)
        .type('text')
        .send('クライアントのビルド（dist/client）が見つかりません。npm run build を実行してください。');
    });
  }

  app.use(bodyErrorHandler);
  return app;
}
