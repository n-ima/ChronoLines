// 画像出力の純ロジック（TASK-204 / US-012 / ui-timeline-grid.md 8章）。
// DOM に触らない部分（ファイル名・sticky 補正の計算・マーキング属性の定義）をここに
// 分離して単体テスト可能にする。DOM を撮る本体は imageExport.ts。

// 失敗時のトースト文言（ui-timeline-grid.md 8章。機能単位に閉じ込め、他へ波及させない）
export const IMAGE_EXPORT_FAILED_MESSAGE = '画像の生成に失敗しました';

// キャプチャ対象のマーキング属性。TimelineGrid が付与し、imageExport.captureGridPng が
// クローン内で参照する（CSS Modules のハッシュ化クラス名に依存しないため属性で示す）
export const CAPTURE_ROOT_ATTR = 'data-capture-root'; // スクロールコンテナ = 可視ビューポート
export const CAPTURE_CONTENT_ATTR = 'data-capture-content'; // 全座標空間の内容（translate で可視域へ寄せる）
export const CAPTURE_STICKY_ATTR = 'data-capture-sticky'; // sticky 要素（値 = 追従軸 x|y|xy）

// JSX へ属性名の定数のまま付与するためのスプレッド用ヘルパ（属性名の二重管理を避ける）
export const captureRootProps = { [CAPTURE_ROOT_ATTR]: 'true' } as const;
export const captureContentProps = { [CAPTURE_CONTENT_ATTR]: 'true' } as const;
export function captureStickyProps(axis: 'x' | 'y' | 'xy'): Record<string, string> {
  return { [CAPTURE_STICKY_ATTR]: axis };
}

// クローンでは position:sticky が効かない（スクロールが無い）ため、ライブ DOM で
// 見えていた位置へ transform で寄せ直す量を計算する。x = 横スクロールに追従（人物列・
// コーナーセル）、y = 縦スクロールに追従（年ヘッダー・イベントレーン）。
// 未知の値（属性なし・不正値）は null = 補正しない
export function stickyTransform(
  axis: string | null,
  scrollLeft: number,
  scrollTop: number,
): string | null {
  if (axis !== 'x' && axis !== 'y' && axis !== 'xy') {
    return null;
  }
  const x = axis === 'x' || axis === 'xy' ? scrollLeft : 0;
  const y = axis === 'y' || axis === 'xy' ? scrollTop : 0;
  return `translate(${x}px, ${y}px)`;
}

// Windows のファイル名に使えない文字（年表名は自由入力のため含まれうる）。
// ブラウザ側の自動置換に任せず '-' へ正規化して環境差をなくす
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

// ファイル名: chronolines-<年表名>-<YYYYMMDD>.png（ui-timeline-grid.md 8章。
// ローカル時刻 = exportDownload.exportFileName と同じ流儀）
export function imageExportFileName(timelineName: string, date: Date): string {
  const safeName = timelineName.replace(INVALID_FILENAME_CHARS, '-');
  return (
    `chronolines-${safeName}-` +
    `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}.png`
  );
}
