// 失敗トースト（TASK-204 / ui-timeline-grid.md 8章「失敗時はトーストのみ」）。
// モックアップにトーストの図例が無いため、エラーバナーの配色トークン
// （--color-error-bg / --color-danger）で補完した最小の自動消滅トースト。
import { useEffect } from 'react';

import styles from './Toast.module.css';

export const TOAST_DURATION_MS = 5000;

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);
  return (
    <div className={styles.toast} role="alert" data-testid="toast">
      {message}
    </div>
  );
}
