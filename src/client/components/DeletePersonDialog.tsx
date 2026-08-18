// 人物の削除確認（US-001 / ui-forms-dialogs.md 1章 / screen-03 dlg-delete / TASK-105）。
// 紐付く個人イベントの有無で分岐: あり → 3択（イベントも削除 / 紐付けを解除して残す /
// キャンセル）、なし → 2択（削除 / キャンセル）。分岐材料（personalEventsOf）は
// 呼び出し側で計算して渡す（このコンポーネントは表示と選択だけを持つ）。
import type { Person, TimelineEvent } from '../../domain/schema';
import { formatYear } from '../../domain/year';
import type { DeletePersonEventPolicy } from '../store/appStore';
import controls from './controls.module.css';
import { Dialog } from './Dialog';
import styles from './dialog.module.css';

export function DeletePersonDialog({
  person,
  personalEvents,
  onDelete,
  onClose,
}: {
  person: Person;
  personalEvents: TimelineEvent[];
  onDelete: (policy: DeletePersonEventPolicy) => void;
  onClose: () => void;
}) {
  if (personalEvents.length === 0) {
    // 個人イベントなし → 2択の確認のみ（policy はどちらでも同結果。deleteEvents を渡す）
    return (
      <Dialog
        title="人物の削除"
        onClose={onClose}
        footer={
          <>
            <button type="button" className={controls.btn} onClick={onClose}>
              キャンセル
            </button>
            <button
              type="button"
              className={controls.btnDanger}
              onClick={() => onDelete('deleteEvents')}
            >
              削除
            </button>
          </>
        }
      >
        <p className={styles.message}>「{person.name}」を削除しますか？</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="人物の削除"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={controls.btn} onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className={controls.btn} onClick={() => onDelete('unlink')}>
            紐付けを解除してイベントは残す
          </button>
          <button
            type="button"
            className={controls.btnDanger}
            onClick={() => onDelete('deleteEvents')}
          >
            イベントも削除する
          </button>
        </>
      }
    >
      <p className={styles.message}>
        「{person.name}」を削除します。この人物に紐付くイベントが{' '}
        <strong>{personalEvents.length}件</strong> あります:
      </p>
      <div className={styles.previewBox} data-testid="delete-person-events">
        {personalEvents.map((event) => (
          <div key={event.id}>
            👤 {event.name}（{formatYear(event.year)}年）
          </div>
        ))}
      </div>
      <p className={styles.note}>紐付くイベントの扱いを選んでください。</p>
    </Dialog>
  );
}
