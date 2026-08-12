// アプリシェル（ui-timeline-grid.md 1章・9章）: ルートエラー境界 + 起動時ロードの状態切替。
// ロード成功後のデータの正は appStore（Zustand。TASK-102）が保持し、自動保存・rev 管理は
// store/autosave.ts（TASK-103）が担う。本コンポーネントはロードフェーズの管理と自動保存の
// 開始だけを持つ。グリッドは TASK-104、リカバリ画面の本実装（復旧操作）は TASK-203 の管轄。
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import type { Store } from '../../domain/schema';
import { useAppStore } from '../store/appStore';
import { startAutosave, storeResponseSchema } from '../store/autosave';
import styles from './AppShell.module.css';
import { ConflictDialog } from './ConflictDialog';
import controls from './controls.module.css';
import { RootErrorBoundary } from './RootErrorBoundary';
import { SaveErrorBanner } from './SaveErrorBanner';
import screen from './statusScreen.module.css';
import { TimelineGrid } from './TimelineGrid';
import { Toolbar } from './Toolbar';

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
  // ready 後のデータ本体は appStore が正、rev は autosave セッションが管理する
  | { phase: 'ready' }
  | { phase: 'connection-error' }
  | {
      phase: 'store-error'; // サーバーには繋がるが保存データが読めない（corrupt / newer）
      code: string;
      message: string;
      detail?: string;
      dataPath?: string;
      fileVersion?: number;
    };

type FetchResult = Exclude<LoadState, { phase: 'ready' }> | { phase: 'ready'; rev: number; store: Store };

async function fetchInitialStore(): Promise<FetchResult> {
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

// ready フェーズの中身。appStore を購読し、以後のミューテーションが表示へ反映される
function ReadyContent() {
  const store = useAppStore((s) => s.store);
  if (store === null) {
    // initializeStore 後にのみ描画されるため通常到達しない。到達したら不整合なので
    // 黙って空画面にせず明示的に失敗させる（ルートエラー境界が受ける）
    throw new Error('ストアが未初期化のまま年表画面が描画されました');
  }
  const active = store.timelines.find((t) => t.id === store.activeTimelineId);
  if (active === undefined) {
    // storeSchema の参照整合性検証済みのため通常到達しない（Toolbar と同じ明示的失敗）
    throw new Error('E-STORE-ACTIVE-MISSING: activeTimelineId が timelines に存在しません');
  }
  return (
    <div className={styles.shell}>
      <Toolbar store={store} />
      {/* 保存失敗の常設バナーはグリッド上部全幅（design-tokens.md 部品の共通規則） */}
      <SaveErrorBanner />
      {/* main はグリッド + サイドパネル（TASK-107）の横並びの器（screen-01 .main） */}
      <main className={styles.main} aria-label="年表グリッド">
        <TimelineGrid timeline={active} />
      </main>
      <ConflictDialog />
    </div>
  );
}

function ShellContent() {
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
        // データの正を appStore へ注入する（初期ロードなので自動保存はかからない）
        useAppStore.getState().initializeStore(next.store);
        // 以後のミューテーションを 500ms デバウンス PUT に乗せる（rev は楽観ロックの起点）
        startAutosave({
          rev: next.rev,
          getStore: () => useAppStore.getState().store,
          // 競合の「読み直し」はユーザー操作による変更ではないため initializeStore
          //（自動保存の対象外）で注入する
          applyServerStore: (store) => {
            useAppStore.getState().initializeStore(store);
          },
        });
        setLoad({ phase: 'ready' });
        return;
      }
      setLoad(next);
    });
  }, []);

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

  return <ReadyContent />;
}

// エラー境界の退避エクスポートが「メモリ上のデータ」へ到達するための参照。
// appStore がミューテーション反映済みの最新データを持つため、未保存の編集も退避できる。
// 描画ツリーの state に依存しないよう Zustand の getState で直接読む（モジュールレベルで安定）
function getStoreForRecovery(): Store | null {
  return useAppStore.getState().store;
}

export function AppShell() {
  return (
    <RootErrorBoundary appVersion={__APP_VERSION__} getStore={getStoreForRecovery}>
      <ShellContent />
    </RootErrorBoundary>
  );
}
