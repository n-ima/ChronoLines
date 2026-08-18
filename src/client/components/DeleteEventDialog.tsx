// イベントの削除確認（US-003 / ui-forms-dialogs.md 2章「フォーム内〔削除〕→ 確認ダイアログ」/
// TASK-106）。人物の個人イベントなし削除（DeletePersonDialog の2択）と同じ確認様式。
import type { TimelineEvent } from '../../domain/schema';
import { formatYear } from '../../domain/year';
import controls from './controls.module.css';
import { Dialog } from './Dialog';
import styles from './dialog.module.css';

export function DeleteEventDialog({
  event,
  onDelete,
  onClose,
}: {
  event: TimelineEvent;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="イベントの削除"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={controls.btn} onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className={controls.btnDanger} onClick={onDelete}>
            削除
          </button>
        </>
      }
    >
      <p className={styles.message}>
        「{event.name}」（{formatYear(event.year)}年）を削除しますか？
      </p>
    </Dialog>
  );
}
