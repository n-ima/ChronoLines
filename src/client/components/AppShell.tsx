// アプリシェル（ui-timeline-grid.md 1章・9章）: ルートエラー境界 + 起動時ロードの状態切替。
// ロード成功後のデータの正は appStore（Zustand。TASK-102）が保持し、自動保存・rev 管理は
// store/autosave.ts（TASK-103）が担う。本コンポーネントはロードフェーズの管理と自動保存の
// 開始だけを持つ。グリッドは TASK-104、リカバリ画面の本実装（復旧操作）は TASK-203 の管轄。
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { allTags, sortedPersonIds } from '../../domain/query';
import type { Store } from '../../domain/schema';
import type { StoredYear } from '../../domain/year';
import {
  useAppStore,
  type DeletePersonEventPolicy,
  type PersonInput,
  type TimelineEventInput,
} from '../store/appStore';
import { startAutosave, storeResponseSchema } from '../store/autosave';
import styles from './AppShell.module.css';
import { ConflictDialog } from './ConflictDialog';
import controls from './controls.module.css';
import { DeleteEventDialog } from './DeleteEventDialog';
import { DeletePersonDialog } from './DeletePersonDialog';
import { EventFormDialog } from './EventFormDialog';
import { PersonFormDialog } from './PersonFormDialog';
import { personalEventsOf } from './personFormModel';
import { RootErrorBoundary } from './RootErrorBoundary';
import { SaveErrorBanner } from './SaveErrorBanner';
import {
  applyQuery,
  currentHit,
  emptySearchState,
  refreshHits,
  stepCursor,
  type SearchState,
} from './searchModel';
import screen from './statusScreen.module.css';
import { TimelineGrid, type SearchScrollRequest } from './TimelineGrid';
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

// 人物フォームの表示状態（TASK-105）。edit の person は id で持ち、描画時に最新の
// ストアから引き直す（生年編集の反映などでフォームと表示の正が食い違わないように）
type PersonDialogState = { mode: 'add' } | { mode: 'edit'; personId: string };

// イベントフォームの表示状態（TASK-106）。add の initialYear は年ヘッダー右クリック
// 〔この年にイベント追加〕の年初期値（null = 空欄）。edit はサイドパネル〔編集〕（TASK-107）と
// DEV用フックから開く（フォーム本体は経路非依存）
type EventDialogState =
  | { mode: 'add'; initialYear: StoredYear | null }
  | { mode: 'edit'; eventId: string };

// ready フェーズの中身。appStore を購読し、以後のミューテーションが表示へ反映される
function ReadyContent() {
  const store = useAppStore((s) => s.store);
  // ダイアログの状態（フックは早期 throw より前に置く）
  const [personDialog, setPersonDialog] = useState<PersonDialogState | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [eventDialog, setEventDialog] = useState<EventDialogState | null>(null);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const openAddPerson = useCallback(() => setPersonDialog({ mode: 'add' }), []);
  const openEditPerson = useCallback(
    (personId: string) => setPersonDialog({ mode: 'edit', personId }),
    [],
  );
  const openDeletePerson = useCallback((personId: string) => setDeleteTargetId(personId), []);
  const openAddEvent = useCallback(() => setEventDialog({ mode: 'add', initialYear: null }), []);
  const openAddEventAtYear = useCallback(
    (year: StoredYear) => setEventDialog({ mode: 'add', initialYear: year }),
    [],
  );
  // サイドパネルのイベント行〔編集〕〔削除〕（TASK-107）。DEV時の window 露出は
  // 機械確認（Playwright）用に維持する（main.tsx の __chronolines と同じ流儀。
  // 本番ビルドには含まれない）
  const openEditEvent = useCallback(
    (eventId: string) => setEventDialog({ mode: 'edit', eventId }),
    [],
  );
  const openDeleteEvent = useCallback((eventId: string) => setDeleteEventId(eventId), []);
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>)['__chronolinesUi'] = { openEditEvent };
      return () => {
        delete (window as unknown as Record<string, unknown>)['__chronolinesUi'];
      };
    }
    return undefined;
  }, [openEditEvent]);

  // 人物検索（TASK-109）。状態は Toolbar（入力・k/n・前へ/次へ）と TimelineGrid（強調・
  // スクロール）で共有するためここに持つ。フックは早期 throw より前に置く規約のため、
  // 検索が参照するアクティブ年表はここでは未検証のまま計算する（不整合は後段の throw が受ける）
  const [search, setSearch] = useState<SearchState>(emptySearchState);
  const [searchScroll, setSearchScroll] = useState<SearchScrollRequest | null>(null);
  const activeTimeline =
    store === null ? undefined : store.timelines.find((t) => t.id === store.activeTimelineId);
  const bumpSearchScroll = useCallback((personId: string) => {
    // seq は単調増加トークン: 同じ人物へのスクロール要求（n=1件で〔次へ〕等)も再発火させる
    setSearchScroll((prev) => ({ personId, seq: (prev?.seq ?? 0) + 1 }));
  }, []);
  // クエリ確定（Toolbar の150msデバウンス後）: ヒット集合を計算し先頭ヒットへスクロール。
  // ヒット0件・空クエリはスクロール要求を出さない（行・スクロール位置とも不変の受け入れ条件）
  const handleSearchQuery = useCallback(
    (query: string) => {
      if (activeTimeline === undefined) {
        return;
      }
      const next = applyQuery(sortedPersonIds(activeTimeline), activeTimeline.persons, query);
      setSearch(next);
      const hit = currentHit(next);
      if (hit !== null) {
        bumpSearchScroll(hit);
      }
    },
    [activeTimeline, bumpSearchScroll],
  );
  // 〔前へ/次へ〕: カーソルを巡回させ、そのヒット行へスクロール
  const handleSearchStep = useCallback(
    (direction: 1 | -1) => {
      const next = stepCursor(search, direction);
      setSearch(next);
      const hit = currentHit(next);
      if (hit !== null) {
        bumpSearchScroll(hit);
      }
    },
    [search, bumpSearchScroll],
  );
  // データ・並び順の変化にヒット集合を追従させる（改名・削除・並び替えで強調のズレを残さない。
  // スクロールは要求しない = ユーザー操作起点のときだけ動かす）
  useEffect(() => {
    if (activeTimeline === undefined) {
      return;
    }
    setSearch((prev) =>
      prev.query === ''
        ? prev
        : refreshHits(prev, sortedPersonIds(activeTimeline), activeTimeline.persons),
    );
  }, [activeTimeline]);

  if (store === null) {
    // initializeStore 後にのみ描画されるため通常到達しない。到達したら不整合なので
    // 黙って空画面にせず明示的に失敗させる（ルートエラー境界が受ける）
    throw new Error('ストアが未初期化のまま年表画面が描画されました');
  }
  const active = activeTimeline;
  if (active === undefined) {
    // storeSchema の参照整合性検証済みのため通常到達しない（Toolbar と同じ明示的失敗）
    throw new Error('E-STORE-ACTIVE-MISSING: activeTimelineId が timelines に存在しません');
  }

  // 編集対象・削除対象は最新のストアから引き直す（すでに消えていたら描画しない）
  const editingPerson =
    personDialog?.mode === 'edit'
      ? (active.persons.find((p) => p.id === personDialog.personId) ?? null)
      : null;
  const deleteTarget =
    deleteTargetId === null ? null : (active.persons.find((p) => p.id === deleteTargetId) ?? null);
  const editingEvent =
    eventDialog?.mode === 'edit'
      ? (active.events.find((e) => e.id === eventDialog.eventId) ?? null)
      : null;
  const deleteEventTarget =
    deleteEventId === null ? null : (active.events.find((e) => e.id === deleteEventId) ?? null);

  // 人物への紐付けの選択肢はグリッドの行順（生年順/手動順）で出す
  const personsById = new Map(active.persons.map((p) => [p.id, p]));
  const sortedPersons = sortedPersonIds(active).flatMap((id) => {
    const person = personsById.get(id);
    return person === undefined ? [] : [person];
  });

  const handleSavePerson = (input: PersonInput) => {
    if (personDialog?.mode === 'edit') {
      useAppStore.getState().updatePerson(personDialog.personId, input);
    } else {
      useAppStore.getState().addPerson(input);
    }
    setPersonDialog(null);
  };

  const handleDeletePerson = (policy: DeletePersonEventPolicy) => {
    if (deleteTargetId !== null) {
      useAppStore.getState().deletePerson(deleteTargetId, policy);
    }
    setDeleteTargetId(null);
    // フォーム内〔削除...〕経由で開いていた場合は、消えた人物のフォームも閉じる
    setPersonDialog(null);
  };

  const handleSaveEvent = (input: TimelineEventInput) => {
    if (eventDialog?.mode === 'edit') {
      useAppStore.getState().updateEvent(eventDialog.eventId, input);
    } else {
      useAppStore.getState().addEvent(input);
    }
    setEventDialog(null);
  };

  const handleDeleteEvent = () => {
    if (deleteEventId !== null) {
      useAppStore.getState().deleteEvent(deleteEventId);
    }
    setDeleteEventId(null);
    // フォーム内〔削除...〕経由で開いていた場合は、消えたイベントのフォームも閉じる
    setEventDialog(null);
  };

  return (
    <div className={styles.shell}>
      <Toolbar
        store={store}
        onAddPerson={openAddPerson}
        onAddEvent={openAddEvent}
        search={search}
        onSearchQuery={handleSearchQuery}
        onSearchStep={handleSearchStep}
      />
      {/* 保存失敗の常設バナーはグリッド上部全幅（design-tokens.md 部品の共通規則） */}
      <SaveErrorBanner />
      {/* main はグリッド + サイドパネルの横並びの器（screen-01 .main） */}
      <main className={styles.main} aria-label="年表グリッド">
        <TimelineGrid
          timeline={active}
          searchHitIds={search.hits}
          searchScroll={searchScroll}
          onEditPerson={openEditPerson}
          onDeletePerson={openDeletePerson}
          onAddEventAtYear={openAddEventAtYear}
          onEditEvent={openEditEvent}
          onDeleteEvent={openDeleteEvent}
        />
      </main>
      {personDialog !== null && (personDialog.mode === 'add' || editingPerson !== null) && (
        <PersonFormDialog
          // 開くたびに初期値から作り直す（別人物の編集へ切り替わったとき状態を残さない）
          key={personDialog.mode === 'edit' ? personDialog.personId : 'add'}
          person={editingPerson}
          registeredTags={allTags(active)}
          onSave={handleSavePerson}
          onRequestDelete={
            personDialog.mode === 'edit' ? () => setDeleteTargetId(personDialog.personId) : null
          }
          onClose={() => setPersonDialog(null)}
        />
      )}
      {deleteTarget !== null && (
        <DeletePersonDialog
          person={deleteTarget}
          personalEvents={personalEventsOf(active, deleteTarget.id)}
          onDelete={handleDeletePerson}
          onClose={() => setDeleteTargetId(null)}
        />
      )}
      {eventDialog !== null && (eventDialog.mode === 'add' || editingEvent !== null) && (
        <EventFormDialog
          // 開くたびに初期値から作り直す（別イベントの編集へ切り替わったとき状態を残さない）
          key={eventDialog.mode === 'edit' ? eventDialog.eventId : 'add'}
          event={editingEvent}
          initialYear={eventDialog.mode === 'add' ? eventDialog.initialYear : null}
          persons={sortedPersons}
          registeredTags={allTags(active)}
          onSave={handleSaveEvent}
          onRequestDelete={
            eventDialog.mode === 'edit' ? () => setDeleteEventId(eventDialog.eventId) : null
          }
          onClose={() => setEventDialog(null)}
        />
      )}
      {deleteEventTarget !== null && (
        <DeleteEventDialog
          event={deleteEventTarget}
          onDelete={handleDeleteEvent}
          onClose={() => setDeleteEventId(null)}
        />
      )}
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
