// リカバリ画面の分離可能ロジック（TASK-203 / US-010 / ui-forms-dialogs.md 6章 /
// server-api.md 3章）。画面（RecoveryScreen.tsx）から fetch と表示を除いた判断部分を
// 単体テスト可能に保つ。ファイル内容の判別・検証はインポートと同じ parseImportFile
// （domain/import.ts）を使う（復旧 = 置き換えインポートの recovery:true 版のため）。
import { z } from 'zod';

import { CURRENT_SCHEMA_VERSION, storeSchema, type Store } from '../../domain/schema';

// 〔空のデータで開始〕（ui-forms-dialogs.md 6章の選択肢3）で PUT する初期ストア。
// サーバーのファイル不在時の初期生成（server/api.ts createInitialStore）・最後の年表削除時の
// 自動作成（appStore createEmptyTimeline）と同じ形（data-model.md 3章の「年表1」）
export function createRecoveryInitialStore(): Store {
  const timelineId = `tl_${crypto.randomUUID()}`;
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

// 手動復旧手順の提示に使う .bak のパス（storage.ts の BAK_FILE = 本体パス + ".bak" と同じ命名。
// dataPath がサーバー応答に無い異常時もファイル名だけで案内を成立させる）
export function bakPathOf(dataPath: string | undefined): string {
  return dataPath === undefined ? 'chronolines.json.bak' : `${dataPath}.bak`;
}

// PUT 失敗時の表示（メッセージ + 折りたたみ detail）。成功はそれ以上の情報を持たない
export type RecoveryPutOutcome = { ok: true } | { ok: false; message: string; detail?: string };

// エラー応答のうち表示に使う部分だけ読む（AppShell の apiErrorSchema と同じ流儀）
const putErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.unknown().optional(),
  }),
});

// detail は string（E-SAVE-FAILED 等）と string[]（E-VALIDATION）の両方があり得る
function normalizeDetail(detail: unknown): string | undefined {
  if (typeof detail === 'string') {
    return detail;
  }
  if (Array.isArray(detail) && detail.every((item) => typeof item === 'string')) {
    return detail.join(' / ');
  }
  return undefined;
}

// PUT 応答 → 画面表示の読み替え（純粋関数。fetch は putRecoveryStore が担う）
export function interpretRecoveryPutResponse(
  responseOk: boolean,
  body: unknown,
): RecoveryPutOutcome {
  if (responseOk) {
    // 2xx = サーバーは書き込みを完了している（応答本文の形の差異で成功を失敗に見せない）
    return { ok: true };
  }
  const parsed = putErrorSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: '復旧の保存に失敗しました（サーバーの応答を解釈できません）。データファイルは変更されていません',
    };
  }
  const { code, message, detail } = parsed.data.error;
  const normalized = normalizeDetail(detail);
  return {
    ok: false,
    message: `${message}（${code}）`,
    ...(normalized !== undefined ? { detail: normalized } : {}),
  };
}

// recovery: true の PUT（server-api.md 3章: corrupt 状態では既存ファイルを
// chronolines.corrupt-<YYYYMMDD-HHmmss>.json に改名保全してから書き込む。rev 照合はスキップ。
// newer 状態は無条件 409 = この関数からも書き込めない。US-010）
export async function putRecoveryStore(store: Store): Promise<RecoveryPutOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/store', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store, recovery: true }),
    });
  } catch {
    return {
      ok: false,
      message:
        'サーバーに接続できませんでした。サーバーが起動しているか確認して、もう一度実行してください。データファイルは変更されていません',
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // JSON でない応答（プロキシのエラーページ等）は body 無しで成否だけ判定する
    body = undefined;
  }
  return interpretRecoveryPutResponse(response.ok, body);
}
