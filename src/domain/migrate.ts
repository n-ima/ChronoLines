// スキーマ移行チェーンと保存データ読み込みの判定（data-model.md 5章 / US-010）。
// ファイルI/Oは持たない（server/storage.ts の管轄。ADR 0002）。JSON 文字列を受けて
// 判定結果を返すだけの純粋関数であり、「書き込んでよいか」の判定までがここの責務。
import { z } from 'zod';

import { CURRENT_SCHEMA_VERSION, storeSchema, type Store } from './schema';

// バージョン N のデータを N+1 に変換する関数の登録簿。現行 v1 のため空。
// 移行を追加するときの契約（data-model.md 5章）:
// - スキーマを変える変更は必ず CURRENT_SCHEMA_VERSION をインクリメントし、
//   旧→新の移行関数をここに登録し、旧形式サンプルを使った単体テストを追加する。
// - 移行はデータを消さない方向でのみ書く（フィールド削除時も可能な限り変換して残す）。
// - 各移行関数は schemaVersion を N+1 に更新した値を返し、throw しない
//   （変換結果の妥当性は最終段の storeSchema 検証が一括で判定する）。
const migrations: Record<number, (data: unknown) => unknown> = {};

export type LoadResult =
  | { ok: true; store: Store; migratedFrom?: number }
  | { ok: false; code: 'NEWER_SCHEMA'; fileVersion: number }
  | { ok: false; code: 'CORRUPT'; detail: string };

// detail に載せる Zod issue は先頭数件に絞る（リカバリ画面での表示用。data-model.md 5章）
const MAX_DETAIL_ISSUES = 5;

function formatZodIssues(error: z.ZodError): string {
  const shown = error.issues.slice(0, MAX_DETAIL_ISSUES).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  const rest = error.issues.length - shown.length;
  return rest > 0 ? `${shown.join(' / ')} ほか${rest}件` : shown.join(' / ');
}

// schemaVersion を「整数で取れる」場合のみ返す（文字列・小数・欠落・非オブジェクトは undefined）
function readSchemaVersion(data: unknown): number | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const version = (data as Record<string, unknown>)['schemaVersion'];
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

// 判定手順5段階（data-model.md 5章のとおり。番号コメントは設計の手順番号）
export function loadStore(raw: string): LoadResult {
  // 1. JSON.parse 失敗 → CORRUPT（detail = パースエラー概要）
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'CORRUPT', detail: `JSONとして解釈できません: ${summary}` };
  }
  return judgeStoreData(parsed);
}

// パース済みの値に対する判定手順2〜5（loadStore の後半）。インポート（domain/import.ts）が
// エクスポート形式ラッパーの store 部分に同じ版判定・移行・厳密検証を適用するために分離
// （data-model.md 6章「インポート時も loadStore 相当の判定を行う」を文字どおり同じ実装で満たす）
export function judgeStoreData(parsed: unknown): LoadResult {
  // 2. schemaVersion が整数で取れない → CORRUPT
  const fileVersion = readSchemaVersion(parsed);
  if (fileVersion === undefined) {
    return { ok: false, code: 'CORRUPT', detail: 'schemaVersion が整数として読み取れません' };
  }

  // 3. 新版 → NEWER_SCHEMA（移行も検証もしない。呼び出し側は一切書き込まない）
  if (fileVersion > CURRENT_SCHEMA_VERSION) {
    return { ok: false, code: 'NEWER_SCHEMA', fileVersion };
  }

  // 4. 旧版 → migrations を昇順に連鎖適用（欠番があれば CORRUPT 扱い）
  let data = parsed;
  for (let version = fileVersion; version < CURRENT_SCHEMA_VERSION; version += 1) {
    const migrate = migrations[version];
    if (migrate === undefined) {
      return {
        ok: false,
        code: 'CORRUPT',
        detail: `schemaVersion ${fileVersion} を現行 ${CURRENT_SCHEMA_VERSION} へ移行できません（v${version}→v${version + 1} の移行関数が未登録）`,
      };
    }
    data = migrate(data);
  }

  // 5. 最後に storeSchema で厳密検証。失敗 → CORRUPT（detail = Zod issue の先頭数件）
  const result = storeSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, code: 'CORRUPT', detail: formatZodIssues(result.error) };
  }
  return fileVersion < CURRENT_SCHEMA_VERSION
    ? { ok: true, store: result.data, migratedFrom: fileVersion }
    : { ok: true, store: result.data };
}
