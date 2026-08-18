// インポートファイルの判別・検証（US-011 / data-model.md 6章 / ui-forms-dialogs.md 5章）。
// 受け付けるのは (a) エクスポート形式（format キーで判別するラッパー）と
// (b) 保存ファイル（Store）そのもの（手動復旧経路。ADR 0002）の2形式。
// どちらも store 部分には loadStore と同じ判定（版判定 → 移行チェーン → 厳密検証）を適用する。
// 純粋関数のみ（ファイル読み取り・ストア反映は呼び出し側 = インポートダイアログの責務）。
import { EXPORT_FORMAT } from './export';
import { judgeStoreData } from './migrate';
import type { Store } from './schema';

// エクスポート形式か保存形式か（プレビューの「エクスポート日時」有無の分岐に使う）
export type ImportSource = 'export' | 'store';

export type ImportParseResult =
  | { ok: true; store: Store; source: ImportSource; exportedAt?: string; migratedFrom?: number }
  | { ok: false; code: 'E-IMPORT-NEWER'; fileVersion: number }
  | { ok: false; code: 'E-IMPORT-INVALID'; detail: string };

// エラーIDカタログ（ui-forms-dialogs.md 5章）。表示側はこの文言をそのまま使う
export const IMPORT_ERROR_MESSAGES = {
  'E-IMPORT-INVALID': 'このファイルは取り込めません（形式が正しくありません）',
  'E-IMPORT-NEWER':
    'より新しいバージョンのアプリでエクスポートされたファイルです。アプリを更新してください',
} as const;

// LoadResult（migrate.ts）→ インポートのエラーID へ読み替える。
// NEWER_SCHEMA → E-IMPORT-NEWER / CORRUPT → E-IMPORT-INVALID（壊れたJSONも検証失敗もここに集約）
function fromLoadResult(
  data: unknown,
  source: ImportSource,
  exportedAt: string | undefined,
): ImportParseResult {
  const result = judgeStoreData(data);
  if (!result.ok) {
    return result.code === 'NEWER_SCHEMA'
      ? { ok: false, code: 'E-IMPORT-NEWER', fileVersion: result.fileVersion }
      : { ok: false, code: 'E-IMPORT-INVALID', detail: result.detail };
  }
  return {
    ok: true,
    store: result.store,
    source,
    ...(exportedAt !== undefined ? { exportedAt } : {}),
    ...(result.migratedFrom !== undefined ? { migratedFrom: result.migratedFrom } : {}),
  };
}

// ファイル内容（テキスト）から形式を自動判別して検証する。
// いずれの失敗でも呼び出し側は既存データに触らないこと（US-011。この関数は判定のみ）
export function parseImportFile(raw: string): ImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: 'E-IMPORT-INVALID',
      detail: `JSONとして解釈できません: ${summary}`,
    };
  }

  // format キーの有無で判別（data-model.md 6章）。保存形式（Store）は strictObject のため
  // format キーを持ち得ない = キーがあればエクスポート形式としてのみ解釈する
  if (typeof parsed === 'object' && parsed !== null && 'format' in parsed) {
    const wrapper = parsed as Record<string, unknown>;
    if (wrapper['format'] !== EXPORT_FORMAT) {
      return {
        ok: false,
        code: 'E-IMPORT-INVALID',
        detail: `format が "${EXPORT_FORMAT}" ではありません`,
      };
    }
    if (!('store' in wrapper)) {
      return {
        ok: false,
        code: 'E-IMPORT-INVALID',
        detail: 'エクスポート形式に store がありません',
      };
    }
    // ラッパーのメタデータ（exportedAt/appVersion 等）は取り込みの成否に関与させない
    // （版判定は store.schemaVersion が正。exportedAt はプレビュー表示にだけ使う）
    const exportedAt = wrapper['exportedAt'];
    return fromLoadResult(
      wrapper['store'],
      'export',
      typeof exportedAt === 'string' ? exportedAt : undefined,
    );
  }

  // 保存形式（Store そのもの）
  return fromLoadResult(parsed, 'store', undefined);
}

// 内容プレビュー「年表n個・人物n人・イベントn件」の集計（ui-forms-dialogs.md 5章）
export interface StoreSummary {
  timelineCount: number;
  personCount: number;
  eventCount: number;
}

export function storeSummary(store: Store): StoreSummary {
  return {
    timelineCount: store.timelines.length,
    personCount: store.timelines.reduce((sum, t) => sum + t.persons.length, 0),
    eventCount: store.timelines.reduce((sum, t) => sum + t.events.length, 0),
  };
}

// exportedAt（例 "2026-08-10T21:30:00+09:00"）→ プレビュー表示用 "2026-08-10 21:30"。
// 想定形式でない文字列はそのまま返す（表示のためだけに取り込みを失敗させない）
export function formatExportedAtDisplay(exportedAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(exportedAt);
  return match === null ? exportedAt : `${match[1]} ${match[2]}`;
}
