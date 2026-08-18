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

// エクスポート範囲（ui-forms-dialogs.md 4章: 現在の年表のみ / すべての年表）
export type ExportScope = 'current' | 'all';

// 「現在の年表のみ」は timelines を表示中の1件に絞り、activeTimelineId をその年表の id に
// 差し替える（絞った結果が E-STORE-ACTIVE-MISSING になる自己矛盾ファイルを生成しない。
// data-model.md 6章）。'all' はストア全体をそのまま返す。
export function storeForExportScope(store: Store, scope: ExportScope): Store {
  if (scope === 'all') {
    return store;
  }
  const active = store.timelines.find((t) => t.id === store.activeTimelineId);
  if (active === undefined) {
    // storeSchema の参照整合性（E-STORE-ACTIVE-MISSING）検証済みのため通常到達しない。
    // 到達したら不整合なので、黙って壊れたファイルを吐かず明示的に失敗させる
    throw new Error('E-STORE-ACTIVE-MISSING: activeTimelineId が timelines に存在しません');
  }
  return { ...store, activeTimelineId: active.id, timelines: [active] };
}
