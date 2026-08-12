// アプリシェル（ui-timeline-grid.md 1章・9章）: ルートエラー境界 + 起動時ロードの状態切替。
// TASK-101 の管轄は GET /api/store による初期ロードとシェル表示まで。
// ストア管理の本実装（Zustand・ミューテーション）は TASK-102、自動保存は TASK-103、
// グリッドは TASK-104、リカバリ画面の本実装（復旧操作）は TASK-203 の管轄。
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { z } from 'zod';

import { storeSchema, type Store } from '../../domain/schema';
import styles from './AppShell.module.css';
import controls from './controls.module.css';
import { RootErrorBoundary } from './RootErrorBoundary';
import screen from './statusScreen.module.css';
import { Toolbar } from './Toolbar';

// GET /api/store の成功応答（server-api.md 3章）。ローカルサーバーの応答も境界で型を
// 確定させる（storeSchema はブランド型 StoredYear の付与も担うためキャストしない）
const storeResponseSchema = z.object({ rev: z.number().int(), store: storeSchema });

// 409 応答（E-STORE-CORRUPT / E-STORE-NEWER）のうち表示に使う部分だけ読む
const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.string().optional(),
    dataPath: z.string().optional(),
    fileVersion: z.number().optional(),
  }),
});

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; rev: number; store: Store }
  | { phase: 'connection-error' }
  | {
      phase: 'store-error'; // サーバーには繋がるが保存データが読めない（corrupt / newer）
      code: string;
      message: string;
      detail?: string;
      dataPath?: string;
      fileVersion?: number;
    };

async function fetchInitialStore(): Promise<LoadState> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetch('/api/store');
    body = await response.json();
  } catch {
    // ネットワークエラー・JSONでない応答（サーバー停止・devプロキシ失敗）= 接続エラー
    return { phase: 'connection-error' };
  }
  if (response.ok) {
    const parsed = storeResponseSchema.safeParse(body);
    if (!parsed.success) {
      // 期待した形の応答でない（バージョン不一致のサーバー等）。再試行で回復を試みる
      return { phase: 'connection-error' };
    }
    return { phase: 'ready', rev: parsed.data.rev, store: parsed.data.store };
  }
  const parsedError = apiErrorSchema.safeParse(body);
  if (!parsedError.success) {
    return { phase: 'connection-error' };
  }
  const { code, message, detail, dataPath, fileVersion } = parsedError.data.error;
  return { phase: 'store-error', code, message, detail, dataPath, fileVersion };
}

function ShellContent({ storeRef }: { storeRef: RefObject<Store | null> }) {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  // 再試行の連打時に古い応答が新しい応答を上書きしないための世代トークン
  const requestSeq = useRef(0);

  const reload = useCallback(() => {
    requestSeq.current += 1;
    const seq = requestSeq.current;
    setLoad({ phase: 'loading' });
    void fetchInitialStore().then((next) => {
      if (requestSeq.current !== seq) {
        return;
      }
      if (next.phase === 'ready') {
        // エラー境界の退避エクスポートが「メモリ上のデータ」へ到達するための参照
        storeRef.current = next.store;
      }
      setLoad(next);
    });
  }, [storeRef]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (load.phase === 'loading') {
    // 起動時ロード中: 中央スピナー（ui-timeline-grid.md 9章）
    return (
      <div className={screen.screen} role="status" aria-label="読み込み中">
        <div className={screen.spinner} />
        <p className={screen.note}>読み込み中…</p>
      </div>
    );
  }

  if (load.phase === 'connection-error') {
    // GET 失敗（接続不可）: 全画面の接続エラー + 再試行（ui-timeline-grid.md 9章）
    return (
      <div className={screen.screen} role="alert">
        <h1 className={screen.title}>サーバーに接続できません</h1>
        <p className={screen.note}>
          ChronoLines のローカルサーバーに接続できませんでした。アプリ（サーバー）が起動しているか確認して、再試行してください。
        </p>
        <div className={screen.actions}>
          <button type="button" className={controls.btnPrimary} onClick={reload}>
            再試行
          </button>
        </div>
      </div>
    );
  }

  if (load.phase === 'store-error') {
    // E-STORE-CORRUPT / E-STORE-NEWER。リカバリ画面の本実装（JSON復旧・空データで開始等）は
    // TASK-203（ui-forms-dialogs.md 6章）。ここでは事実の表示のみ行う（書き込み操作は無い =
    // 既存ファイルには一切触らない。US-010）
    return (
      <div className={screen.screen} role="alert">
        <h1 className={screen.title}>{load.message}</h1>
        <p className={screen.note}>エラーコード: {load.code}</p>
        {load.detail !== undefined && <p className={screen.note}>{load.detail}</p>}
        {load.fileVersion !== undefined && (
          <p className={screen.note}>保存ファイルの形式バージョン: {load.fileVersion}</p>
        )}
        {load.dataPath !== undefined && (
          <p className={screen.note}>データファイル: {load.dataPath}</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Toolbar store={load.store} />
      {/* 年表グリッド（TimelineGrid）は TASK-104。ここではシェルの器だけを用意する */}
      <main className={styles.main} aria-label="年表グリッド" />
    </div>
  );
}

export function AppShell() {
  const storeRef = useRef<Store | null>(null);
  const getStore = useCallback(() => storeRef.current, []);
  return (
    <RootErrorBoundary appVersion={__APP_VERSION__} getStore={getStore}>
      <ShellContent storeRef={storeRef} />
    </RootErrorBoundary>
  );
}
