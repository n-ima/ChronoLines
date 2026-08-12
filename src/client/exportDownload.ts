// クライアント側のJSONエクスポート補助（data-model.md 6章）。
// 日時整形は現在時刻に依存しない純粋関数（Date を引数で受ける）にしてテスト可能にする。

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

// exportedAt の表記: ローカル時刻 + タイムゾーンオフセット（例 "2026-08-12T10:00:00+09:00"。
// data-model.md 6章の例のとおり。Date#toISOString は UTC 表記になるため自前で整形する）
export function formatExportedAt(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  );
}

// ファイル名: chronolines-export-YYYYMMDD-HHmm.json（data-model.md 6章。ローカル時刻）
export function exportFileName(date: Date): string {
  return (
    `chronolines-export-${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}.json`
  );
}

// Blob + アンカークリックでブラウザのダウンロードを起動する（サーバーを経由しない。
// 保存エラー時・エラー境界でも動く退避手段であること自体が要件。ADR 0002）
export function downloadJson(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
