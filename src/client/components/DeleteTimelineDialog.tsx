// 年表削除の確認（US-009 / ui-forms-dialogs.md 3章 / screen-03 dlg-tl-delete / TASK-113）。
// 削除は〔削除する〕で承諾しない限り実行されない（受け入れ条件）。「人物n人・イベントm件も
// 削除される」旨を warn ボックスで明示する。実削除（最後の1つ → 空の「年表1」自動作成を
// 含む）は appStore.deleteTimeline の管轄で、このコンポーネントは表示と承諾だけを持つ。
import type { Timeline } from '../../domain/schema';
import controls from './controls.module.css';
import { Dialog } from './Dialog';
import styles from './dialog.module.css';
import { deleteImpact } from './timelineManagerModel';

export function DeleteTimelineDialog({
  timeline,
  onDelete,
  onClose,
}: {
  timeline: Timeline;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { personCount, eventCount } = deleteImpact(timeline);
  return (
    <Dialog
      title="年表の削除"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={controls.btn} onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className={controls.btnDanger} onClick={onDelete}>
            削除する
          </button>
        </>
      }
    >
      <p className={styles.message}>年表「{timeline.name}」を削除しますか？</p>
      <div className={styles.warn} data-testid="delete-timeline-warn">
        人物{personCount}人・イベント{eventCount}
        件もすべて削除されます。この操作は取り消せません。必要ならエクスポートでバックアップしてから削除してください。
      </div>
    </Dialog>
  );
}
