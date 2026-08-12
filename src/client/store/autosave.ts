// 自動保存プロトコルのクライアント実装（server-api.md 5章 / US-009 / TASK-103）。
// - 全ミューテーション後の 500ms デバウンス PUT（連続編集は最後の1回に集約）
// - pagehide 時の keepalive フラッシュ
// - rev 管理（楽観ロックの合意点。PUT 成功・読み直しで更新）
// - E-REV-CONFLICT の競合分岐・ネットワークエラー/5xx の失敗分岐（UI は useSaveStore を購読）
// appStore とは一方向依存（appStore → notifyMutation）に保ち、ストア本体への参照は
// startAutosave のコールバックで受け取る（循環 import を作らない。テストも同じ口を使う）。
import { z } from 'zod';
import { create } from 'zustand';

import { storeSchema, type Store } from '../../domain/schema';

// GET /api/store の成功応答（server-api.md 3章）。初期ロード（AppShell）と競合解決の
// 読み直し・上書きで共用する（storeSchema はブランド型 StoredYear の付与も担うためキャストしない）
export const storeResponseSchema = z.object({ rev: z.number().int(), store: storeSchema });

// PUT /api/store の成功応答
const putResponseSchema = z.object({ rev: z.number().int() });

// エラー応答のうち競合判定（E-REV-CONFLICT）に使う部分だけ読む
const errorCodeSchema = z.object({ error: z.object({ code: z.string() }) });

export const AUTOSAVE_DEBOUNCE_MS = 500;

// 保存状態UI（Toolbar の「保存済み HH:mm:ss」・常設エラーバナー・競合ダイアログ）が購読する状態
export interface SaveUiState {
  // 最後に PUT が成功した時刻（HH:mm:ss）。null = このセッションではまだ保存していない
  savedAt: string | null;
  // ネットワークエラー・5xx 等で保存できていない（常設バナー表示。編集はメモリ保持で継続可能）
  failed: boolean;
  // E-REV-CONFLICT 検出（競合ダイアログ表示。どちらかの解決を選ぶまで PUT を保留する）
  conflict: boolean;
}

export const useSaveStore = create<SaveUiState>()(() => ({
  savedAt: null,
  failed: false,
  conflict: false,
}));

interface AutosaveSession {
  // サーバーと合意済みの rev（楽観ロック）。PUT 成功と競合解決の GET で更新する
  rev: number;
  getStore: () => Store | null;
  // 競合の「読み直し」でサーバー版を注入する口（ユーザー操作による変更ではないため
  // 呼び出し先は initializeStore = 自動保存の対象外であること）
  applyServerStore: (store: Store) => void;
  timer: ReturnType<typeof setTimeout> | null;
  // 最後の PUT 成功以降に未保存の変更があるか（失敗時もメモリ上の編集内容はここで追跡し続ける）
  dirty: boolean;
  inFlight: boolean;
  // PUT 応答待ち中にデバウンスが満了した（応答後に最新スナップショットを追送する）
  flushQueued: boolean;
}

let session: AutosaveSession | null = null;

function clearTimer(s: AutosaveSession): void {
  if (s.timer !== null) {
    clearTimeout(s.timer);
    s.timer = null;
  }
}

// 「保存済み HH:mm:ss」の時刻書式（screen-01 / screen-04 の save-state 表示）
function formatTime(date: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`;
}

export interface StartAutosaveOptions {
  // 初期ロード（GET /api/store）で得た rev
  rev: number;
  getStore: () => Store | null;
  applyServerStore: (store: Store) => void;
}

// 初期ロード成功時（AppShell の ready 遷移）に開始する。再スタートは前セッションを破棄する
// （React StrictMode の二重実行でも多重リスナー・多重タイマーにならない）
export function startAutosave(options: StartAutosaveOptions): void {
  stopAutosave();
  session = {
    rev: options.rev,
    getStore: options.getStore,
    applyServerStore: options.applyServerStore,
    timer: null,
    dirty: false,
    inFlight: false,
    flushQueued: false,
  };
  useSaveStore.setState({ savedAt: null, failed: false, conflict: false });
  // タブを閉じる・リロード時にデバウンス中の未送信変更を即時フラッシュする（server-api.md 5章）。
  // node 環境の単体テストには window が無いため、テストは handlePagehide を直接呼ぶ
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', handlePagehide);
  }
}

export function stopAutosave(): void {
  if (session === null) {
    return;
  }
  clearTimer(session);
  session = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', handlePagehide);
  }
}

// すべてのミューテーション（appStore の mutate() / replaceStore）から呼ばれる唯一の入口。
// 自動保存が動いていない文脈（初期ロード前・appStore 単体テスト）では何もしない
export function notifyMutation(): void {
  const s = session;
  if (s === null) {
    return;
  }
  s.dirty = true;
  if (useSaveStore.getState().conflict) {
    // 競合ダイアログの解決待ち中は送っても再び競合するだけなのでスケジュールしない
    // （変更は dirty として保持し、解決の選択に応じて破棄または上書き保存される）
    return;
  }
  clearTimer(s);
  s.timer = setTimeout(() => {
    s.timer = null;
    void flush(false);
  }, AUTOSAVE_DEBOUNCE_MS);
}

// 常設エラーバナーの〔再試行〕。デバウンスを待たず即時に送る
export function retrySave(): void {
  const s = session;
  if (s === null) {
    return;
  }
  clearTimer(s);
  void flush(false);
}

// pagehide: デバウンス中の未送信変更を keepalive で即時フラッシュ（server-api.md 5章）。
// PUT 応答待ち中・競合解決待ち中は送らない（前者は直後の応答で確定し、後者は再び競合する
// だけ。それでも残るごく短い喪失窓はプロセス強制終了と同様に許容する = 設計5章の割り切り）
export function handlePagehide(): void {
  const s = session;
  if (s === null || !s.dirty || s.inFlight) {
    return;
  }
  if (useSaveStore.getState().conflict) {
    return;
  }
  clearTimer(s);
  void flush(true);
}

// 競合ダイアログ「最新を読み込み直す（自分の変更は破棄）」: GET で最新を取得して置き換える
export async function resolveConflictByReload(): Promise<void> {
  const s = session;
  if (s === null) {
    return;
  }
  const latest = await fetchLatest();
  if (session !== s) {
    return;
  }
  if (latest === null) {
    // 読み直しの GET も失敗 = サーバーと通信できない。ダイアログを閉じて常設バナーへ倒す
    // （自分の変更はメモリに保持されたまま。再試行すると再び競合ダイアログに戻れる）
    useSaveStore.setState({ conflict: false, failed: true });
    return;
  }
  s.rev = latest.rev;
  s.dirty = false; // 自分の変更は破棄する（設計5章の選択肢どおり）
  clearTimer(s);
  s.flushQueued = false;
  s.applyServerStore(latest.store);
  useSaveStore.setState({ conflict: false, failed: false });
}

// 競合ダイアログ「自分の内容で上書きする」: GET で最新 rev を取得してから再 PUT（設計5章）。
// GET と PUT の間に別タブがさらに保存した場合は再び競合ダイアログに戻る（安全側）
export async function resolveConflictByOverwrite(): Promise<void> {
  const s = session;
  if (s === null) {
    return;
  }
  const latest = await fetchLatest();
  if (session !== s) {
    return;
  }
  if (latest === null) {
    useSaveStore.setState({ conflict: false, failed: true });
    return;
  }
  s.rev = latest.rev;
  s.dirty = true; // メモリ上の自分の内容をそのまま保存し直す
  useSaveStore.setState({ conflict: false });
  await flush(false);
}

async function fetchLatest(): Promise<{ rev: number; store: Store } | null> {
  try {
    const response = await fetch('/api/store');
    if (!response.ok) {
      return null;
    }
    const parsed = storeResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type PutOutcome = 'saved' | 'conflict' | 'failed';

async function flush(keepalive: boolean): Promise<void> {
  const s = session;
  if (s === null) {
    return;
  }
  if (s.inFlight) {
    s.flushQueued = true;
    return;
  }
  if (!s.dirty) {
    return;
  }
  const store = s.getStore();
  if (store === null) {
    return; // ready 前は起動しない設計のため通常到達しない
  }
  // 送信中の再変更を検出できるよう先に下ろす（失敗したら結果処理で dirty に戻す）
  s.dirty = false;
  s.inFlight = true;
  const outcome = await sendPut(s, store, keepalive);
  if (session !== s) {
    return; // 応答待ちの間に再スタートされた古いセッションの結果は反映しない
  }
  s.inFlight = false;
  if (outcome === 'saved') {
    useSaveStore.setState({ savedAt: formatTime(new Date()), failed: false });
    if (s.flushQueued) {
      // 応答待ち中に満了したデバウンス分（より新しいスナップショット）を追送する
      s.flushQueued = false;
      void flush(false);
    }
    return;
  }
  s.dirty = true; // 保存できていない変更が残っている（メモリ上の編集内容は失わない）
  s.flushQueued = false;
  if (outcome === 'conflict') {
    clearTimer(s);
    useSaveStore.setState({ conflict: true });
  } else {
    // ネットワークエラー・5xx: 常設バナー + 〔再試行〕。以後の変更時の自動再試行は
    // notifyMutation が通常どおりスケジュールすることで実現する（設計5章。ここで
    // 自動リトライのタイマーは張らない = サーバー停止中の無限再送をしない）
    useSaveStore.setState({ failed: true });
  }
}

async function sendPut(s: AutosaveSession, store: Store, keepalive: boolean): Promise<PutOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/store', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: s.rev, store }),
      // pagehide 時のみ true（ページ破棄後もブラウザが送信を継続する。server-api.md 5章）
      keepalive,
    });
  } catch {
    return 'failed'; // ネットワークエラー（サーバー停止・devプロキシ失敗）
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return 'failed'; // JSON でない応答（プロキシのエラーページ等）
  }
  if (response.ok) {
    const parsed = putResponseSchema.safeParse(body);
    if (!parsed.success) {
      return 'failed'; // 期待した形の応答でない（バージョン不一致のサーバー等）
    }
    s.rev = parsed.data.rev; // rev 管理: 楽観ロックの合意点を進める
    return 'saved';
  }
  const parsedError = errorCodeSchema.safeParse(body);
  if (parsedError.success && parsedError.data.error.code === 'E-REV-CONFLICT') {
    return 'conflict';
  }
  // E-VALIDATION 等の想定外 4xx はミューテーションが整合性を保証しているため正常系では
  // 発生しない（発生したらバグ）。データを失わない安全側 = 常設バナー（編集はメモリ保持で
  // 継続）に倒し、調査の手掛かりを console に残す（監視なしのローカルアプリでは画面と
  // console が唯一のログ。リカバリ画面への誘導系は TASK-203 の管轄）
  console.error('自動保存が拒否されました:', response.status, body);
  return 'failed';
}
