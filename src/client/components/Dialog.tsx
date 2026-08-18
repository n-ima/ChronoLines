// モーダルダイアログの共通枠（ui-forms-dialogs.md 共通仕様: オーバーレイ + Esc/✕/
// オーバーレイクリックで閉じる。破棄確認などの「閉じてよいか」の判断は onClose 側の責務）。
// 見た目は screen-03-forms.html の .overlay/.dialog/.dlg-head/.dlg-foot のとおり。
import { useEffect, useRef, type ReactNode } from 'react';

import styles from './dialog.module.css';

// 開いているダイアログのスタック。Esc は最前面のダイアログだけを閉じる
// （人物フォームの上に削除確認が重なる構成のため。US-001）
const dialogStack: symbol[] = [];

// ダイアログが1つでも開いているか（TimelineGrid の Esc = 選択列解除が、開いている
// ダイアログの Esc と衝突しないための判定。TASK-107）
export function hasOpenDialog(): boolean {
  return dialogStack.length > 0;
}

export function Dialog({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  // Esc・オーバーレイの共通ハンドラから常に最新の onClose を呼ぶ（effect の再登録を避ける）
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const token = Symbol('dialog');
    dialogStack.push(token);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dialogStack[dialogStack.length - 1] === token) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = dialogStack.indexOf(token);
      if (index !== -1) {
        dialogStack.splice(index, 1);
      }
    };
  }, []);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        // ダイアログ本体のクリックでは閉じない（screen-03 と同じ e.target === overlay 判定）
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} aria-label="閉じる" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        <div className={styles.foot}>{footer}</div>
      </div>
    </div>
  );
}
