// 常設の保存エラーバナー（server-api.md 5章 / screen-01 .banner.error）。ネットワーク
// エラー・5xx で保存できていない間、グリッド上部全幅に表示し続ける。編集はメモリ保持で
// 継続でき、〔再試行〕で即時再送する（以後の変更でも自動で再試行される）。
// JSONエクスポートを退避手段として案内する（ADR 0002 の劣化受け皿）
import { retrySave, useSaveStore } from '../store/autosave';
import controls from './controls.module.css';
import styles from './SaveErrorBanner.module.css';

export function SaveErrorBanner() {
  const failed = useSaveStore((s) => s.failed);
  const savedAt = useSaveStore((s) => s.savedAt);
  if (!failed) {
    return null;
  }
  return (
    <div className={styles.banner} role="alert">
      保存できていません（最終保存: {savedAt ?? 'なし'}
      ）。編集内容はこの画面に保持されています。復旧しない場合は「入出力」からJSONエクスポートで退避できます。
      <button type="button" className={`${controls.btn} ${styles.retry}`} onClick={retrySave}>
        再試行
      </button>
    </div>
  );
}
