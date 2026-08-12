import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../../src/client/store/appStore';
import {
  AUTOSAVE_DEBOUNCE_MS,
  handlePagehide,
  notifyMutation,
  resolveConflictByOverwrite,
  resolveConflictByReload,
  retrySave,
  startAutosave,
  stopAutosave,
  useSaveStore,
} from '../../src/client/store/autosave';
import { storeSchema, type Store } from '../../src/domain/schema';

// 自動保存プロトコル（server-api.md 5章 / TASK-103）のテスト。fetch をモックし、
// タイマーは fake timers で決定的に進める。done契約の4観点（デバウンス集約・rev更新・
// 競合分岐・失敗時のメモリ保持と再試行）+ pagehide フラッシュ + appStore との配線を網羅する。

function makeStore(personNames: string[]): Store {
  return storeSchema.parse({
    schemaVersion: 1,
    activeTimelineId: 'tl_1',
    timelines: [
      {
        id: 'tl_1',
        name: '年表1',
        persons: personNames.map((name, i) => ({
          id: `p_${i}`,
          name,
          birth: { year: 1543 },
          tags: [],
        })),
        events: [],
        sortMode: 'birthAsc',
        personOrder: [],
        view: { startYear: null, endYear: null, zoom: 'year' },
      },
    ],
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

// flush → fetch → json → 状態反映のマイクロタスク連鎖を確実に消化する
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

// fetch 呼び出し（PUT）のボディを取り出す
function putPayload(callIndex: number): { rev: number; store: Store; init: RequestInit } {
  const call = fetchMock.mock.calls[callIndex];
  if (call === undefined) {
    throw new Error(`fetch 呼び出し ${callIndex} がありません`);
  }
  const init = call[1];
  if (init === undefined || typeof init.body !== 'string') {
    throw new Error(`fetch 呼び出し ${callIndex} は PUT ではありません`);
  }
  return { ...(JSON.parse(init.body) as { rev: number; store: Store }), init };
}

// 保存対象のスナップショット（プロトコル単体のテストではプレーンな変数で代用する。
// appStore との配線は最後の describe で実データを使って確認する）
let current: Store | null;
const applyServerStore = vi.fn((store: Store) => {
  current = store;
});

function start(rev = 1): void {
  startAutosave({ rev, getStore: () => current, applyServerStore });
}

// 「編集」= スナップショットの差し替え + notifyMutation（mutate() 相当）
function edit(personNames: string[]): void {
  current = makeStore(personNames);
  notifyMutation();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 12, 14, 3, 22, 0));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  current = makeStore(['徳川家康']);
  applyServerStore.mockClear();
});

afterEach(() => {
  stopAutosave();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('デバウンス集約', () => {
  it('連続編集は最後の変更から500ms後の1回のPUTに集約され、最新スナップショットを送る', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 2 }));
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(300);
    edit(['家康', '信長']);
    await vi.advanceTimersByTimeAsync(300);
    edit(['家康', '信長', '秀吉']);
    // 最後の編集から 500ms 未満では送信されない
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { rev, store } = putPayload(0);
    expect(rev).toBe(1);
    expect(store.timelines[0]?.persons.map((p) => p.name)).toEqual(['家康', '信長', '秀吉']);
  });

  it('変更がなければPUTしない', async () => {
    start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUT成功で「保存済み HH:mm:ss」の時刻が入り、failed が消える', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 2 }));
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    // 14:03:22.000 開始 + 500ms 経過 = 14:03:22
    expect(useSaveStore.getState()).toMatchObject({ savedAt: '14:03:22', failed: false });
  });

  it('PUT応答待ち中にデバウンスが満了した変更は、応答後に追送される', async () => {
    let resolveFirst: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 3 }));
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS); // PUT1 送信（応答保留）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    edit(['家康', '信長']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS); // 応答待ち中に満了 → キュー
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFirst(jsonResponse({ rev: 2 }));
    await settle();
    // 応答後に更新済み rev で最新スナップショットを追送する
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = putPayload(1);
    expect(second.rev).toBe(2);
    expect(second.store.timelines[0]?.persons.map((p) => p.name)).toEqual(['家康', '信長']);
  });
});

describe('rev更新', () => {
  it('PUT成功のたびに応答の rev を次のPUTに使う（楽観ロックの合意点を進める）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 2 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 3 }));
    start(1);
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    edit(['家康', '信長']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(putPayload(0).rev).toBe(1);
    expect(putPayload(1).rev).toBe(2);
  });
});

describe('競合分岐（E-REV-CONFLICT）', () => {
  async function reachConflict(): Promise<void> {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'E-REV-CONFLICT', currentRev: 5 } }, 409),
    );
    start(1);
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(useSaveStore.getState().conflict).toBe(true);
  }

  it('409 E-REV-CONFLICT で競合状態になり、解決までは以後の変更でもPUTしない', async () => {
    await reachConflict();
    edit(['家康', '信長']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 最初の競合PUTのみ
  });

  it('読み直し: GETの最新storeを注入し、自分の変更は破棄され、以後は新しいrevで保存する', async () => {
    await reachConflict();
    const serverStore = makeStore(['別タブの人物']);
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 5, store: serverStore }));
    await resolveConflictByReload();
    expect(applyServerStore).toHaveBeenCalledTimes(1);
    expect(useSaveStore.getState().conflict).toBe(false);
    // 破棄済みなので時間が経ってもPUTされない（競合PUT + GET の2回のまま）
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 以後の変更は GET で得た rev=5 でPUTされる
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 6 }));
    edit(['別タブの人物', '追記']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(putPayload(2).rev).toBe(5);
  });

  it('上書き: GETで最新revを取得してから自分の内容を再PUTする', async () => {
    await reachConflict();
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 5, store: makeStore(['別タブの人物']) }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 6 }));
    await resolveConflictByOverwrite();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3); // 競合PUT + GET + 再PUT
    const gets = fetchMock.mock.calls[1];
    expect(gets?.[1]).toBeUndefined(); // 2回目は GET（init なし）
    const rePut = putPayload(2);
    expect(rePut.rev).toBe(5); // 最新revで
    expect(rePut.store.timelines[0]?.persons.map((p) => p.name)).toEqual(['家康']); // 自分の内容
    expect(useSaveStore.getState().conflict).toBe(false);
    expect(useSaveStore.getState().savedAt).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('上書きの再PUTがさらに競合したら、再び競合ダイアログに戻る', async () => {
    await reachConflict();
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 5, store: makeStore(['別タブの人物']) }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'E-REV-CONFLICT', currentRev: 7 } }, 409),
    );
    await resolveConflictByOverwrite();
    await settle();
    expect(useSaveStore.getState().conflict).toBe(true);
  });

  it('読み直しのGETも失敗したらダイアログを閉じて常設バナーへ倒す（変更はメモリ保持）', async () => {
    await reachConflict();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await resolveConflictByReload();
    expect(useSaveStore.getState()).toMatchObject({ conflict: false, failed: true });
    expect(applyServerStore).not.toHaveBeenCalled();
  });
});

describe('失敗時のメモリ保持と再試行', () => {
  it('ネットワークエラーで failed になり、savedAt（最終保存）は変わらない', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(useSaveStore.getState()).toMatchObject({ savedAt: null, failed: true });
    // スナップショット（メモリ上の編集内容）はそのまま保持されている
    expect(current?.timelines[0]?.persons.map((p) => p.name)).toEqual(['家康']);
  });

  it('5xx（E-SAVE-FAILED）でも failed になる', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'E-SAVE-FAILED', message: '保存に失敗しました' } }, 500),
    );
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(useSaveStore.getState().failed).toBe(true);
    consoleError.mockRestore();
  });

  it('想定外の4xx（E-VALIDATION）も失敗として扱い、手掛かりを console に残す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'E-VALIDATION', message: 'スキーマ検証失敗' } }, 400),
    );
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(useSaveStore.getState().failed).toBe(true);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('〔再試行〕で即時に再PUTし、成功したらバナーが消えて保存済みになる', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(useSaveStore.getState().failed).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 2 }));
    retrySave();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useSaveStore.getState()).toMatchObject({ failed: false });
    expect(useSaveStore.getState().savedAt).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('失敗後の以後の変更で自動再試行される（未送信分もまとめて保存される）', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(useSaveStore.getState().failed).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 2 }));
    edit(['家康', '信長']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useSaveStore.getState().failed).toBe(false);
    expect(putPayload(1).store.timelines[0]?.persons.map((p) => p.name)).toEqual([
      '家康',
      '信長',
    ]);
  });
});

describe('pagehide の keepalive フラッシュ', () => {
  it('デバウンス中の未送信変更を keepalive:true で即時送信し、タイマーは解除される', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 2 }));
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(100); // デバウンス満了前
    handlePagehide();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { rev, init } = putPayload(0);
    expect(rev).toBe(1);
    expect(init.keepalive).toBe(true);
    // 元のデバウンスタイマーは解除済み = 二重送信しない
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('未変更なら pagehide でも送信しない', async () => {
    start();
    handlePagehide();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('競合の解決待ち中は pagehide でも送信しない（再び競合するだけのため）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'E-REV-CONFLICT', currentRev: 5 } }, 409),
    );
    start();
    edit(['家康']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(useSaveStore.getState().conflict).toBe(true);
    handlePagehide();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1); // 競合PUTのみ
  });
});

describe('appStore との配線（mutate() / replaceStore / initializeStore）', () => {
  beforeEach(() => {
    useAppStore.setState({ store: null });
    useAppStore.getState().initializeStore(makeStore(['徳川家康']));
    startAutosave({
      rev: 1,
      getStore: () => useAppStore.getState().store,
      applyServerStore: (store) => {
        useAppStore.getState().initializeStore(store);
      },
    });
  });

  it('addPerson（mutate経由）が500ms後のPUTに乗り、追加した人物がボディに含まれる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 2 }));
    useAppStore.getState().addPerson({
      name: '明智光秀',
      birth: makeStore(['x']).timelines[0]!.persons[0]!.birth,
      death: undefined,
      tags: [],
    });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const names = putPayload(0).store.timelines[0]?.persons.map((p) => p.name);
    expect(names).toContain('明智光秀');
    // PUT失敗ではないが、メモリ上の appStore にも当然残っている（保存とメモリは独立）
    expect(
      useAppStore
        .getState()
        .store?.timelines[0]?.persons.some((p) => p.name === '明智光秀'),
    ).toBe(true);
  });

  it('replaceStore も自動保存の対象になる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rev: 2 }));
    useAppStore.getState().replaceStore(makeStore(['置き換え後']));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(putPayload(0).store.timelines[0]?.persons[0]?.name).toBe('置き換え後');
  });

  it('initializeStore（初期ロード・競合読み直し）は自動保存の対象にならない', async () => {
    useAppStore.getState().initializeStore(makeStore(['再注入']));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUT失敗時も appStore のデータは失われない（メモリ保持）', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    useAppStore.getState().renameTimeline('tl_1', '改名後');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(useSaveStore.getState().failed).toBe(true);
    expect(useAppStore.getState().store?.timelines[0]?.name).toBe('改名後');
  });
});
