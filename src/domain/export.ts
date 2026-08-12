// エクスポートファイル形式（data-model.md 6章）: 保存データ（Store）そのものに
// 識別用メタデータを付けたもの。生成はこの関数に一元化し、エクスポートダイアログ
// （TASK-201）とルートエラー境界の退避エクスポート（ui-timeline-grid.md 9章）が共用する。
// domain の純粋性規約により現在時刻はここで取得しない（exportedAt は呼び出し側が渡す）。
import type { Store } from './schema';

// インポート時の形式判別キー（data-model.md 6章: format キーで判別）
export const EXPORT_FORMAT = 'chronolines-export';

export interface ExportPayload {
  format: typeof EXPORT_FORMAT;
  exportedAt: string; // 例: "2026-08-12T10:00:00+09:00"（ローカル時刻 + オフセット表記）
  appVersion: string;
  store: Store;
}

// キー順も data-model.md 6章の例のとおり（format が先頭 = 判別キーがファイル冒頭に出る)
export function buildExportPayload(
  store: Store,
  meta: { exportedAt: string; appVersion: string },
): ExportPayload {
  return {
    format: EXPORT_FORMAT,
    exportedAt: meta.exportedAt,
    appVersion: meta.appVersion,
    store,
  };
}
