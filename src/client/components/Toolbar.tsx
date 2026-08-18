// ツールバーの枠（TASK-101）+ 保存状態表示（TASK-103）+ 〔＋人物〕（TASK-105）+
// 〔＋イベント〕（TASK-106）+ ズームトグル〔1年|10年〕（TASK-108）+ 人物検索（TASK-109）。
// 構成・見た目は screen-01-main-grid.html のとおり。
// 残るコントロールの配線は後続タスクの管轄:
// 年表切替=TASK-113、タグ=TASK-110、並び順=TASK-111、範囲=TASK-112、
// 入出力=TASK-201/202、
// 画像出力=TASK-204。それまでは disabled の枠として置く（表示値はストアの実データを反映する）。
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import type { Store, Timeline } from '../../domain/schema';
import { useAppStore } from '../store/appStore';
import { useSaveStore } from '../store/autosave';
import controls from './controls.module.css';
import {
  hitCountLabel,
  isNoHit,
  SEARCH_DEBOUNCE_MS,
  type SearchState,
} from './searchModel';
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

// 人物検索ボックス（TASK-109 / screen-01 .search-wrap）。入力の生値はローカルに持ち、
// 150ms デバウンスで確定値だけを親（AppShell）へ渡す。「k/n件」+〔前へ/次へ〕はヒットが
// あるときのみ、「該当なし」はクエリありでヒット0件のときのみ表示（ui-timeline-grid.md 6章）
function SearchBox({
  search,
  onQuery,
  onStep,
}: {
  search: SearchState;
  onQuery: (query: string) => void;
  onStep: (direction: 1 | -1) => void;
}) {
  const [rawQuery, setRawQuery] = useState('');
  const timerRef = useRef<number | null>(null);
  // デバウンス満了時は「予約時点」でなく「発火時点」の最新の props を呼ぶ
  //（150ms の間にストアが変わっても古い行順で検索しない）
  const onQueryRef = useRef(onQuery);
  onQueryRef.current = onQuery;
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setRawQuery(value);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onQueryRef.current(value);
    }, SEARCH_DEBOUNCE_MS);
  };
  const label = hitCountLabel(search);
  return (
    <div className={styles.searchWrap}>
      <input
        className={`${styles.input} ${styles.search}`}
        type="text"
        placeholder="人物名で検索"
        aria-label="人物名で検索"
        value={rawQuery}
        onChange={handleChange}
      />
      {label !== null && (
        <>
          <span className={styles.searchHits} data-testid="search-hits">
            {label}
          </span>
          <button
            type="button"
            className={styles.searchNav}
            aria-label="前のヒットへ"
            onClick={() => onStep(-1)}
          >
            前へ
          </button>
          <button
            type="button"
            className={styles.searchNav}
            aria-label="次のヒットへ"
            onClick={() => onStep(1)}
          >
            次へ
          </button>
        </>
      )}
      {isNoHit(search) && (
        <div className={styles.searchNone} data-testid="search-none" role="status">
          該当なし
        </div>
      )}
    </div>
  );
}

// ズームトグル（US-007）。選択中の側の再クリックは何もしない
// （無変更の setZoom で自動保存のデバウンスを起こさないため）
function setZoomIfChanged(active: Timeline, zoom: Timeline['view']['zoom']): void {
  if (active.view.zoom !== zoom) {
    useAppStore.getState().setZoom(zoom);
  }
}

export function Toolbar({
  store,
  onAddPerson,
  onAddEvent,
  search,
  onSearchQuery,
  onSearchStep,
}: {
  store: Store;
  // 〔＋人物〕→ 人物フォーム（新規）を開く（TASK-105。ダイアログの状態は AppShell が持つ）
  onAddPerson: () => void;
  // 〔＋イベント〕→ イベントフォーム（新規・年初期値なし）を開く（TASK-106）
  onAddEvent: () => void;
  // 人物検索（TASK-109）。状態はグリッドの強調・スクロールと共有するため AppShell が持つ
  search: SearchState;
  onSearchQuery: (query: string) => void;
  onSearchStep: (direction: 1 | -1) => void;
}) {
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
      <SearchBox search={search} onQuery={onSearchQuery} onStep={onSearchStep} />
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
          aria-pressed={active.view.zoom === 'year'}
          onClick={() => setZoomIfChanged(active, 'year')}
        >
          1年
        </button>
        <button
          type="button"
          className={active.view.zoom === 'decade' ? styles.zoomOn : styles.zoomBtn}
          aria-pressed={active.view.zoom === 'decade'}
          onClick={() => setZoomIfChanged(active, 'decade')}
        >
          10年
        </button>
      </div>
      <div className={styles.grow} />
      <button type="button" className={controls.btnPrimary} onClick={onAddPerson}>
        ＋人物
      </button>
      <button type="button" className={controls.btn} onClick={onAddEvent}>
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
