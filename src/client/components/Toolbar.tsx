// ツールバーの枠（TASK-101）+ 保存状態表示（TASK-103）+ 〔＋人物〕（TASK-105）+
// 〔＋イベント〕（TASK-106）+ ズームトグル〔1年|10年〕（TASK-108）+ 人物検索（TASK-109）+
// タグ絞り込み〔タグ▼〕（TASK-110）+ 並び順〔生年順|手動〕（TASK-111）+
// 表示範囲〔開始年〕〔終了年〕（TASK-112）+ 年表切替ドロップダウン（TASK-113）。
// 構成・見た目は screen-01-main-grid.html のとおり。
// 残るコントロールの配線は後続タスクの管轄:
// 入出力=TASK-201/202、
// 画像出力=TASK-204。それまでは disabled の枠として置く（表示値はストアの実データを反映する）。
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import type { Store, Timeline } from '../../domain/schema';
import { formatYear, type StoredYear } from '../../domain/year';
import { tagDotColor, tagPillColors } from '../tagColor';
import { useAppStore } from '../store/appStore';
import { useSaveStore } from '../store/autosave';
import controls from './controls.module.css';
import {
  RANGE_ERROR_MESSAGES,
  parseRangeInputs,
  rangeInputValues,
  rangePlaceholders,
  type RangeParseError,
} from './rangeModel';
import {
  hitCountLabel,
  isNoHit,
  SEARCH_DEBOUNCE_MS,
  type SearchState,
} from './searchModel';
import { tagButtonLabel, tagFilterOptions } from './tagFilterModel';
import { MANAGE_TIMELINES_VALUE } from './timelineManagerModel';
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

// タグ絞り込み（TASK-110 / ui-timeline-grid.md 6章 / screen-01 .tag-dd-wrap / .tag-dd）。
// ドロップダウンの開閉だけをローカルに持ち、選択集合は AppShell（グリッドの行・イベント
// レーン・検索と共有）が持つ。チェックのトグルでは閉じない（複数選択の連続操作のため。
// 閉じるのはボタン再クリックとドロップダウン外クリック = screen-01 と同じ）
function TagFilterDropdown({
  timeline,
  selected,
  onToggle,
  onClear,
}: {
  timeline: Timeline;
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDocMouseDown = (event: MouseEvent) => {
      const wrap = wrapRef.current;
      if (wrap !== null && event.target instanceof Node && !wrap.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);
  const options = tagFilterOptions(timeline);
  return (
    <div className={styles.tagWrap} ref={wrapRef}>
      <button
        type="button"
        className={controls.btn}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {tagButtonLabel(selected)}
      </button>
      {open && (
        <div className={styles.tagDd} role="group" aria-label="タグで絞り込み" data-testid="tag-dd">
          {options.length === 0 ? (
            // 登録タグ0個のときの空表示はモックアップに無い（判断: 空のパネルは壊れて見える
            // ため TagPicker と同じ流儀の説明文を置く）
            <div className={styles.tagDdEmpty}>登録済みのタグはありません</div>
          ) : (
            options.map(({ tag, personCount, eventCount }) => (
              <label key={tag} className={styles.tagDdRow}>
                <input
                  type="checkbox"
                  checked={selected.includes(tag)}
                  onChange={() => onToggle(tag)}
                />
                <span className={styles.tagDdDot} style={{ background: tagDotColor(tag) }} />
                {tag}
                <span className={styles.tagDdCount}>
                  人物{personCount}・イベント{eventCount}
                </span>
              </label>
            ))
          )}
          <div className={styles.tagDdFoot}>
            <button type="button" className={styles.tagDdClear} onClick={onClear}>
              すべて解除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 適用中の色付きピル（screen-01 .active-tags / .tag-pill）。各ピルの ✕ で個別解除
function ActiveTagPills({
  selected,
  onRemove,
}: {
  selected: string[];
  onRemove: (tag: string) => void;
}) {
  if (selected.length === 0) {
    return null;
  }
  return (
    <div className={styles.activeTags} data-testid="active-tags">
      {selected.map((tag) => (
        <span key={tag} className={styles.tagPill} style={tagPillColors(tag)}>
          <span className={styles.tagPillDot} style={{ background: tagDotColor(tag) }} />
          {tag}
          <button
            type="button"
            className={styles.tagPillX}
            aria-label={`タグ「${tag}」の絞り込みを解除`}
            onClick={() => onRemove(tag)}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

// 表示範囲〔開始年〕〔終了年〕（TASK-112 / ui-timeline-grid.md 7章 / US-006 /
// screen-01 .range-wrap）。生入力はローカルに持ち、blur / Enter でまとめてコミットする
// （キー入力ごとの適用は「1」「15」…の途中値でグリッドが跳ぶため）。空欄 = 自動で、
// プレースホルダに自動値「1521（自動）」を薄く表示する。不正入力はインラインエラーを
// 入力欄直下に出して適用しない（直前の適用値を維持）。エラーは開始 → 終了 → 反転の
// 優先順で1件だけ表示する（モックアップにエラー状態の図例が無いため、searchNone と同じ
// 「直下に重ねて出す」流儀で補完。2欄同時のエラー文は重なって読めなくなるため1件に絞る）
function RangeInputs({ timeline }: { timeline: Timeline }) {
  // 現在年 = 実行時のシステム日付の年（TimelineGrid と同じ流儀。domain は引数で受ける）
  const currentYear = useMemo(() => new Date().getFullYear() as StoredYear, []);
  const viewStart = timeline.view.startYear;
  const viewEnd = timeline.view.endYear;
  const [raw, setRaw] = useState<{ start: string; end: string }>(() =>
    rangeInputValues(timeline.view),
  );
  const [error, setError] = useState<RangeParseError | null>(null);
  // view の変化（コミット・年表切替・競合の読み直し）に表示を追従させる
  // （表示は常に formatYear へ正規化。「-100」と打っても「前100」で表示する = US-005）
  useEffect(() => {
    const next = {
      start: viewStart === null ? '' : formatYear(viewStart),
      end: viewEnd === null ? '' : formatYear(viewEnd),
    };
    setRaw((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    setError(null);
  }, [timeline.id, viewStart, viewEnd]);
  const commit = () => {
    const result = parseRangeInputs(raw.start, raw.end);
    if (!result.ok) {
      setError(result); // エラー時は適用しない（直前の適用値を維持）
      return;
    }
    setError(null);
    setRaw({
      start: result.start === null ? '' : formatYear(result.start),
      end: result.end === null ? '' : formatYear(result.end),
    });
    if (result.start !== viewStart || result.end !== viewEnd) {
      useAppStore.getState().setViewRange(result.start, result.end);
    }
  };
  const onKeyDown = (event: { key: string }) => {
    if (event.key === 'Enter') {
      commit();
    }
  };
  const placeholders = rangePlaceholders(timeline, currentYear);
  return (
    <div className={styles.range}>
      範囲
      <input
        className={`${styles.input} ${styles.rangeInput}`}
        type="text"
        placeholder={placeholders.start}
        aria-label="開始年"
        value={raw.start}
        aria-invalid={error !== null && (error.field === 'start' || error.field === 'range')}
        onChange={(event) => setRaw({ ...raw, start: event.target.value })}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      〜
      <input
        className={`${styles.input} ${styles.rangeInput}`}
        type="text"
        placeholder={placeholders.end}
        aria-label="終了年"
        value={raw.end}
        aria-invalid={error !== null && (error.field === 'end' || error.field === 'range')}
        onChange={(event) => setRaw({ ...raw, end: event.target.value })}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {error !== null && (
        <div
          className={styles.rangeError}
          data-testid="range-error"
          data-code={error.code}
          role="alert"
        >
          {RANGE_ERROR_MESSAGES[error.code]}
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
  onManageTimelines,
  onAddPerson,
  onAddEvent,
  search,
  onSearchQuery,
  onSearchStep,
  selectedTags,
  onToggleTag,
  onRemoveTag,
  onClearTags,
}: {
  store: Store;
  // 年表切替ドロップダウンの〔年表の管理...〕→ 管理ダイアログを開く（TASK-113。
  // ダイアログの状態は他のダイアログと同じく AppShell が持つ）
  onManageTimelines: () => void;
  // 〔＋人物〕→ 人物フォーム（新規）を開く（TASK-105。ダイアログの状態は AppShell が持つ）
  onAddPerson: () => void;
  // 〔＋イベント〕→ イベントフォーム（新規・年初期値なし）を開く（TASK-106）
  onAddEvent: () => void;
  // 人物検索（TASK-109）。状態はグリッドの強調・スクロールと共有するため AppShell が持つ
  search: SearchState;
  onSearchQuery: (query: string) => void;
  onSearchStep: (direction: 1 | -1) => void;
  // タグ絞り込み（TASK-110）。選択集合はグリッドの行・イベントレーン・検索と共有するため
  // AppShell が持つ（ドロップダウンの開閉だけがツールバーのローカル状態）
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onClearTags: () => void;
}) {
  const active = store.timelines.find((t) => t.id === store.activeTimelineId);
  if (active === undefined) {
    // storeSchema の参照整合性（E-STORE-ACTIVE-MISSING）検証済みのため通常到達しない。
    // 到達したらデータ不整合なので黙って描画を続けず明示的に失敗させる（ルートエラー境界が受ける）
    throw new Error('E-STORE-ACTIVE-MISSING: activeTimelineId が timelines に存在しません');
  }
  return (
    <header className={styles.toolbar}>
      {/* 年表切替ドロップダウン（TASK-113 / ui-forms-dialogs.md 3章 / screen-01 #tl-select）。
          切替（switchTimeline）は選択1クリックで完了する。末尾の〔年表の管理...〕は切替でなく
          管理ダイアログを開く（controlled select のため表示値は activeTimelineId のまま戻る） */}
      <select
        className={styles.select}
        aria-label="年表"
        value={store.activeTimelineId}
        onChange={(event) => {
          const value = event.target.value;
          if (value === MANAGE_TIMELINES_VALUE) {
            onManageTimelines();
            return;
          }
          if (value !== store.activeTimelineId) {
            useAppStore.getState().switchTimeline(value);
          }
        }}
      >
        {store.timelines.map((timeline) => (
          <option key={timeline.id} value={timeline.id}>
            {timeline.name}
          </option>
        ))}
        <option value={MANAGE_TIMELINES_VALUE}>年表の管理...</option>
      </select>
      <SearchBox search={search} onQuery={onSearchQuery} onStep={onSearchStep} />
      <TagFilterDropdown
        timeline={active}
        selected={selectedTags}
        onToggle={onToggleTag}
        onClear={onClearTags}
      />
      <ActiveTagPills selected={selectedTags} onRemove={onRemoveTag} />
      {/* 並び順の切替（TASK-111 / ui-timeline-grid.md 6章）。見た目の正はモックアップの
          select（screen-01。設計本文の「トグル」はこの2択切替を指す）。〔生年順〕への復帰は
          ワンクリックで、personOrder は保持される（再度〔手動〕で前回の手動順に復帰。
          data-model.md 4章 = appStore.setSortMode の契約） */}
      <select
        className={styles.select}
        aria-label="並び順"
        value={active.sortMode}
        onChange={(event) => {
          const mode = event.target.value === 'manual' ? 'manual' : 'birthAsc';
          if (mode !== active.sortMode) {
            useAppStore.getState().setSortMode(mode);
          }
        }}
      >
        <option value="birthAsc">並び順: 生年順</option>
        <option value="manual">並び順: 手動</option>
      </select>
      <RangeInputs timeline={active} />
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
