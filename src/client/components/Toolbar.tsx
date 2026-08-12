// ツールバーの枠（TASK-101）+ 保存状態表示（TASK-103）。構成・見た目は
// screen-01-main-grid.html のとおり。各コントロールの動作の配線は後続タスクの管轄:
// 年表切替=TASK-113、検索=TASK-109、タグ=TASK-110、並び順=TASK-111、範囲=TASK-112、
// ズーム=TASK-108、＋人物=TASK-105、＋イベント=TASK-106、入出力=TASK-201/202、
// 画像出力=TASK-204。それまでは disabled の枠として置く（表示値はストアの実データを反映する）。
import type { Store } from '../../domain/schema';
import { useSaveStore } from '../store/autosave';
import controls from './controls.module.css';
import styles from './Toolbar.module.css';

// 保存状態（ツールバー右端。screen-01/-04 の save-state）: 通常時は「保存済み HH:mm:ss」、
// 保存失敗・競合の解決待ち中は danger 色で「未保存の変更あり」（server-api.md 5章）
function SaveStatus() {
  const savedAt = useSaveStore((s) => s.savedAt);
  const unsaved = useSaveStore((s) => s.failed || s.conflict);
  if (unsaved) {
    return (
      <span className={styles.saveStateDirty} role="status">
        未保存の変更あり
      </span>
    );
  }
  // savedAt が null のうち（起動直後・未保存）は空のステータス領域を保つ
  return (
    <span className={styles.saveState} role="status">
      {savedAt === null ? '' : `保存済み ${savedAt}`}
    </span>
  );
}

export function Toolbar({ store }: { store: Store }) {
  const active = store.timelines.find((t) => t.id === store.activeTimelineId);
  if (active === undefined) {
    // storeSchema の参照整合性（E-STORE-ACTIVE-MISSING）検証済みのため通常到達しない。
    // 到達したらデータ不整合なので黙って描画を続けず明示的に失敗させる（ルートエラー境界が受ける）
    throw new Error('E-STORE-ACTIVE-MISSING: activeTimelineId が timelines に存在しません');
  }
  return (
    <header className={styles.toolbar}>
      <select className={styles.select} aria-label="年表" value={store.activeTimelineId} disabled>
        {store.timelines.map((timeline) => (
          <option key={timeline.id} value={timeline.id}>
            {timeline.name}
          </option>
        ))}
      </select>
      <input
        className={`${styles.input} ${styles.search}`}
        type="text"
        placeholder="人物名で検索"
        aria-label="人物名で検索"
        disabled
      />
      <button type="button" className={controls.btn} disabled>
        タグ ▼
      </button>
      <select className={styles.select} aria-label="並び順" value={active.sortMode} disabled>
        <option value="birthAsc">並び順: 生年順</option>
        <option value="manual">並び順: 手動</option>
      </select>
      <div className={styles.range}>
        範囲
        <input
          className={`${styles.input} ${styles.rangeInput}`}
          type="text"
          placeholder="自動"
          aria-label="開始年"
          disabled
        />
        〜
        <input
          className={`${styles.input} ${styles.rangeInput}`}
          type="text"
          placeholder="自動"
          aria-label="終了年"
          disabled
        />
      </div>
      <div className={styles.zoomToggle} role="group" aria-label="ズーム">
        <button
          type="button"
          className={active.view.zoom === 'year' ? styles.zoomOn : styles.zoomBtn}
          disabled
        >
          1年
        </button>
        <button
          type="button"
          className={active.view.zoom === 'decade' ? styles.zoomOn : styles.zoomBtn}
          disabled
        >
          10年
        </button>
      </div>
      <div className={styles.grow} />
      <button type="button" className={controls.btnPrimary} disabled>
        ＋人物
      </button>
      <button type="button" className={controls.btn} disabled>
        ＋イベント
      </button>
      <button type="button" className={controls.btn} disabled>
        入出力
      </button>
      <button type="button" className={controls.btn} disabled>
        画像出力
      </button>
      <SaveStatus />
    </header>
  );
}
