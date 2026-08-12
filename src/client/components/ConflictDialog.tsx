// 多重タブ競合（E-REV-CONFLICT）ダイアログ（server-api.md 5章・7章）。選択肢は設計の
// 2つのみで、キャンセルは設けない（どちらかを選ぶまで自動保存は保留 = 放置状態を作らない）。
// メッセージは「何が起きたか + データがどうなっているか + 次にできること」を含める
// （ui-forms-dialogs.md 7章のエラーメッセージの原則）
import { useState } from 'react';

import {
  resolveConflictByOverwrite,
  resolveConflictByReload,
  useSaveStore,
} from '../store/autosave';
import styles from './ConflictDialog.module.css';
import controls from './controls.module.css';

export function ConflictDialog() {
  const conflict = useSaveStore((s) => s.conflict);
  const [busy, setBusy] = useState(false);
  if (!conflict) {
    return null;
  }
  const run = (action: () => Promise<void>) => () => {
    setBusy(true);
    void action().finally(() => {
      setBusy(false);
    });
  };
  return (
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
      >
        <h2 id="conflict-dialog-title" className={styles.title}>
          別のタブまたはウィンドウでデータが更新されています
        </h2>
        <p className={styles.note}>
          このタブの変更はまだ保存されていません。最新を読み込み直すとこのタブの変更は破棄されます。自分の内容で上書きすると、別のタブで保存された内容は失われます。
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={controls.btn}
            disabled={busy}
            onClick={run(resolveConflictByReload)}
          >
            最新を読み込み直す（自分の変更は破棄）
          </button>
          <button
            type="button"
            className={controls.btn}
            disabled={busy}
            onClick={run(resolveConflictByOverwrite)}
          >
            自分の内容で上書きする
          </button>
        </div>
      </div>
    </div>
  );
}
