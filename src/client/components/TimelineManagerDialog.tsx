// 年表管理ダイアログ（US-009 / ui-forms-dialogs.md 3章 / screen-03 dlg-timelines / TASK-113）。
// 一覧（名前・人物数・イベント数）・切替・名前変更（インライン編集）・〔＋新しい年表〕を持つ。
// 削除は確認ダイアログ（DeleteTimelineDialog）経由でのみ実行されるため onRequestDelete で
// 親（AppShell）へ委譲する。表示用導出・名前検証は timelineManagerModel.ts（単体テスト対象）。
import { useId, useState, type KeyboardEvent } from 'react';

import type { Store } from '../../domain/schema';
import { useAppStore } from '../store/appStore';
import controls from './controls.module.css';
import { Dialog } from './Dialog';
import dialog from './dialog.module.css';
import {
  TIMELINE_NAME_MESSAGES,
  timelineListItems,
  validateTimelineName,
} from './timelineManagerModel';
import styles from './TimelineManagerDialog.module.css';

// インラインエラー（フィールド直下。data-error-code は機械確認・E2E 用のフック =
// PersonFormDialog の FieldError と同じ流儀。エラーは E-T-NAME-EMPTY の1種のみ）
function NameError() {
  return (
    <div className={dialog.err} role="alert" data-error-code="E-T-NAME-EMPTY">
      {TIMELINE_NAME_MESSAGES['E-T-NAME-EMPTY']}
    </div>
  );
}

// 名前変更中の状態（同時に編集できるのは1行だけ）。submitted 後は入力が直るまで
// エラーを出し続ける（表示判定はレンダリング時に再検証 = 人物フォームと同じ挙動）
type RenameState = { id: string; value: string; submitted: boolean };

export function TimelineManagerDialog({
  store,
  onRequestDelete,
  onClose,
}: {
  store: Store;
  onRequestDelete: (timelineId: string) => void;
  onClose: () => void;
}) {
  const newNameId = useId();
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const [newName, setNewName] = useState('');
  const [newSubmitted, setNewSubmitted] = useState(false);

  const items = timelineListItems(store);
  const renameError = renaming !== null && renaming.submitted && !validateTimelineName(renaming.value).ok;
  const newNameError = newSubmitted && !validateTimelineName(newName).ok;

  const commitRename = () => {
    if (renaming === null) {
      return;
    }
    const result = validateTimelineName(renaming.value);
    if (!result.ok) {
      setRenaming({ ...renaming, submitted: true });
      return;
    }
    const current = store.timelines.find((t) => t.id === renaming.id);
    // 同名のまま保存は no-op（無変更の自動保存 PUT を起こさない。Toolbar のズームと同じ流儀）
    if (current !== undefined && current.name !== result.name) {
      useAppStore.getState().renameTimeline(renaming.id, result.name);
    }
    setRenaming(null);
  };

  const create = () => {
    const result = validateTimelineName(newName);
    if (!result.ok) {
      setNewSubmitted(true);
      return;
    }
    // 空の年表を作成し切替（ui-forms-dialogs.md 3章 = appStore.addTimeline の契約）。
    // ダイアログは開いたまま一覧に反映する（続けて名前変更・削除等の管理操作ができるように）
    useAppStore.getState().addTimeline(result.name);
    setNewName('');
    setNewSubmitted(false);
  };

  const onEnter = (event: KeyboardEvent<HTMLInputElement>, action: () => void) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      action();
    }
  };

  return (
    <Dialog
      title="年表の管理"
      onClose={onClose}
      footer={
        <button type="button" className={controls.btn} onClick={onClose}>
          閉じる
        </button>
      }
    >
      {items.map((item) =>
        renaming !== null && renaming.id === item.id ? (
          <div key={item.id} className={styles.tlRow} data-testid="tl-row">
            <div className={styles.renameBox}>
              <input
                className={renameError ? dialog.inputError : dialog.input}
                type="text"
                aria-label={`年表「${item.name}」の新しい名前`}
                value={renaming.value}
                maxLength={50}
                autoFocus
                onChange={(event) => setRenaming({ ...renaming, value: event.target.value })}
                onKeyDown={(event) => onEnter(event, commitRename)}
              />
              {renameError && <NameError />}
            </div>
            <button type="button" className={controls.btnPrimary} onClick={commitRename}>
              保存
            </button>
            <button type="button" className={controls.btn} onClick={() => setRenaming(null)}>
              キャンセル
            </button>
          </div>
        ) : (
          <div
            key={item.id}
            className={styles.tlRow}
            data-testid="tl-row"
            data-active={item.isActive || undefined}
          >
            <strong>{item.name}</strong>
            <span className={styles.meta}>
              人物{item.personCount}人・イベント{item.eventCount}件
              {item.isActive ? '（表示中）' : ''}
            </span>
            <span className={styles.grow} />
            {/* 表示中の年表に〔切替〕は出さない（screen-03 のとおり） */}
            {!item.isActive && (
              <button
                type="button"
                className={controls.btn}
                onClick={() => useAppStore.getState().switchTimeline(item.id)}
              >
                切替
              </button>
            )}
            <button
              type="button"
              className={controls.btn}
              onClick={() => setRenaming({ id: item.id, value: item.name, submitted: false })}
            >
              名前変更
            </button>
            <button
              type="button"
              className={controls.btnDanger}
              onClick={() => onRequestDelete(item.id)}
            >
              削除
            </button>
          </div>
        ),
      )}
      <div className={`${dialog.field} ${styles.newField}`}>
        <label className={dialog.label} htmlFor={newNameId}>
          新しい年表
        </label>
        <div className={styles.newRow}>
          <div className={styles.newBox}>
            <input
              id={newNameId}
              className={newNameError ? dialog.inputError : dialog.input}
              type="text"
              placeholder="年表名（例: 三国志）"
              value={newName}
              maxLength={50}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => onEnter(event, create)}
            />
            {newNameError && <NameError />}
          </div>
          <div>
            <button type="button" className={controls.btnPrimary} onClick={create}>
              ＋作成
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
