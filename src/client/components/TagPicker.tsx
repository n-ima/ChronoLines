// タグピッカー（人物・イベントフォーム共通部品。ui-forms-dialogs.md 1章 / screen-03）。
// 構成（上から）: (1) 付与済みピル（✕で除去） (2) 登録済みタグから選択（第一の動線）
// (3) 新規タグの入力欄（Enter で作成・付与。入力中は登録済み候補を部分一致で絞り込む =
// サジェスト。既存を選べば新規作成しない）。ロジックは tagPickerModel.ts（テスト対象）。
import { useState } from 'react';

import { tagDotColor, tagPillColors } from '../tagColor';
import styles from './TagPicker.module.css';
import { addTag, removeTag, tagSuggestions } from './tagPickerModel';

export function TagPicker({
  assigned,
  registered,
  onChange,
}: {
  assigned: string[];
  // 年表内の登録済みタグ（allTags の結果を受け取る。人物・イベントの和集合）
  registered: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');
  // 入力中は「登録済みタグから選択」を部分一致で絞り込む（サジェストを兼ねる）
  const candidates = tagSuggestions(registered, assigned, input);

  const add = (tag: string) => {
    const next = addTag(assigned, tag);
    if (next !== assigned) {
      onChange(next);
    }
    setInput('');
  };

  return (
    <div className={styles.picker}>
      <div className={styles.assigned} data-testid="tag-assigned">
        {assigned.length === 0 ? (
          <span className={styles.none}>タグなし（下から選択、または新規作成）</span>
        ) : (
          assigned.map((tag) => (
            <button
              key={tag}
              type="button"
              className={styles.pill}
              style={tagPillColors(tag)}
              title={`タグ「${tag}」を外す`}
              onClick={() => onChange(removeTag(assigned, tag))}
            >
              <span className={styles.dot} style={{ background: tagDotColor(tag) }} />
              {tag}
              <span className={styles.x}>✕</span>
            </button>
          ))
        )}
      </div>
      <div className={styles.availLabel}>登録済みタグから選択:</div>
      <div className={styles.avail} data-testid="tag-avail">
        {candidates.length === 0 ? (
          <span className={styles.none}>
            {input.trim() === ''
              ? 'すべて付与済み'
              : '一致する登録済みタグはありません（Enterで新規作成）'}
          </span>
        ) : (
          candidates.map((tag) => (
            <button
              key={tag}
              type="button"
              className={styles.addable}
              style={tagPillColors(tag)}
              title={`タグ「${tag}」を付与`}
              onClick={() => add(tag)}
            >
              <span className={styles.dot} style={{ background: tagDotColor(tag) }} />
              {tag}
            </button>
          ))
        )}
      </div>
      <div className={styles.newtag}>
        <input
          className={styles.newtagInput}
          value={input}
          placeholder="新しいタグ名を入力"
          aria-label="新しいタグ名"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // IME 変換確定の Enter では付与しない（日本語タグ入力の必須ガード）
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault(); // フォーム送信（保存）に化けさせない
              add(input);
            }
          }}
        />
        <span className={styles.newtagSub}>Enterで新規作成</span>
      </div>
    </div>
  );
}
