// 年表グリッド（TASK-104: 1年ズーム。ui-timeline-grid.md 1〜2章 / ADR 0003 / screen-01）。
// 行(人物)・列(年)に @tanstack/react-virtual の virtualizer を1つずつ使い、可視窓 +
// オーバースキャン5 のセルだけを DOM に実体化する。セル値は描画時に cellValue で
// 都度計算し、300万セル分の配列・キャッシュ・巨大 useMemo を作らない（ADR 0003）。
// イベントレーン・選択列・サイドパネル（TASK-107: ui-timeline-grid.md 3〜4章）も本体で持つ
// （選択列の強調とパネルの年齢比較は行・列の状態を共有するため）。
// 10年ズーム（TASK-108: ui-timeline-grid.md 5章 / screen-02）は「列 = 年」を
// 「列 = 10年区間」に置き換えるだけで同じ仮想化機構を使う（ADR 0003）。
// 切替時は切替前の可視範囲の中心年を保持してスクロール位置を再計算する（US-007）。
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { eventsByColumn } from '../../domain/query';
import type { Person, Timeline } from '../../domain/schema';
import { cellValue, formatYear, type StoredYear } from '../../domain/year';
import { tagDotColor } from '../tagColor';
import { hasOpenDialog } from './Dialog';
import { chipColors, chipTooltip, eventsAtYear, laneColumn } from './selectionModel';
import { SidePanel } from './SidePanel';
import { visibleEvents, visibleRowIds } from './tagFilterModel';
import styles from './TimelineGrid.module.css';
import {
  CELL_H,
  EVENT_LANE_H,
  EVENT_LANE_H_DECADE,
  NAME_COL_W,
  OVERSCAN,
  YEAR_HEADER_H,
  cellText,
  cellTooltip,
  centerYearAstro,
  columnKeyAstro,
  columnLabel,
  columnWidth,
  columnYear,
  decadeCellValue,
  decadeRangeLabel,
  gridColumns,
  isDecadeGuideYear,
  lifespanLabel,
  personTooltip,
  scrollLeftForCenterYear,
  type GridColumns,
  type ZoomLevel,
} from './timelineGridModel';

// 人物列に表示するタグ色ドットの最大数（ui-timeline-grid.md 1章）
const MAX_TAG_DOTS = 4;

// 列の縦罫線の強調（10倍数年ガイド・現在年。ui-timeline-grid.md 2章）。
// 年ヘッダーとセルの両方に同じ規則を適用する
function columnRuleClass(year: StoredYear, currentYear: StoredYear): string {
  if (year === currentYear) {
    return ` ${styles.currentCol}`;
  }
  return isDecadeGuideYear(year) ? ` ${styles.guideCol}` : '';
}

// コンテキストメニューの共通枠（人物行の行メニューと年ヘッダー右クリックメニューで共用。
// Esc/メニュー外クリックで閉じる・画面端でのはみ出しクランプ）
type RowMenuState = { personId: string; x: number; y: number };
type YearMenuState = { year: StoredYear; x: number; y: number };

const MENU_W = 200; // 画面端でのはみ出しクランプ用（.rowMenu の min-width より広めの概算値）
const MENU_H = 80;

function ContextMenu({
  x,
  y,
  ariaLabel,
  onClose,
  children,
}: {
  x: number;
  y: number;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const left = Math.max(0, Math.min(x, window.innerWidth - MENU_W));
  const top = Math.max(0, Math.min(y, window.innerHeight - MENU_H));
  return (
    // 透明バックドロップ: メニュー外クリックで閉じる（クリックは下の要素へ通さない）
    <div className={styles.menuBackdrop} onMouseDown={onClose}>
      <div
        className={styles.rowMenu}
        style={{ left, top }}
        role="menu"
        aria-label={ariaLabel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

type GridRowProps = {
  person: Person;
  top: number;
  columns: GridColumns;
  virtualCols: VirtualItem[];
  currentYear: StoredYear;
  // 選択列（null = 未選択）。変更時は可視行だけが再レンダリングされる（memo 化の範囲）
  selectedYear: StoredYear | null;
  // 検索ヒット行 = 人物列を --color-row-hilite で強調（TASK-109 / screen-01 .name-cell.hit）
  searchHit: boolean;
  onOpenMenu: (personId: string, x: number, y: number) => void;
};

// 行コンポーネントは memo 化し、縦スクロールでは可視域に入った行だけがマウントされる
// （既存行は props が安定しているため再レンダリングされない。ADR 0003）
const GridRow = memo(function GridRow({
  person,
  top,
  columns,
  virtualCols,
  currentYear,
  selectedYear,
  searchHit,
  onOpenMenu,
}: GridRowProps) {
  return (
    <div className={styles.row} style={{ top, height: CELL_H }} data-person-id={person.id}>
      <div
        className={`${styles.nameCell}${searchHit ? ` ${styles.nameCellHit}` : ''}`}
        style={{ width: NAME_COL_W }}
        data-search-hit={searchHit ? 'true' : undefined}
        title={personTooltip(person)}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-label={`${person.name} のメニュー`}
        onClick={(event) => onOpenMenu(person.id, event.clientX, event.clientY)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenMenu(person.id, rect.left + 8, rect.bottom);
          }
        }}
      >
        <span className={styles.name}>{person.name}</span>
        <span className={styles.years}>{lifespanLabel(person)}</span>
        {person.tags.length > 0 && (
          <span className={styles.tagDots}>
            {person.tags.slice(0, MAX_TAG_DOTS).map((tag) => (
              <i
                key={tag}
                className={styles.tagDot}
                style={{ background: tagDotColor(tag) }}
                title={tag}
              />
            ))}
          </span>
        )}
      </div>
      {virtualCols.map((col) => {
        const year = columnYear(columns, col.index);
        if (columns.zoom === 'decade') {
          // 10年ズームの集約セル（ui-timeline-grid.md 5章 / screen-02）。ツールチップ・
          // 罫線ガイドは screen-02 に無いため付けない（見た目の正はモックアップ）
          const value = decadeCellValue(person, columnKeyAstro(columns, col.index), currentYear);
          const kindClass =
            value.kind === 'alive' ? ` ${styles.alive}` : value.kind === 'virtual' ? ` ${styles.virtual}` : '';
          const birthMarker = value.kind === 'alive' && value.birthMarker;
          const deathMarker = value.kind === 'alive' && value.deathMarker;
          const selClass =
            year === selectedYear
              ? ` ${styles.selcol}${value.kind === 'blank' ? ` ${styles.selcolBlank}` : ''}`
              : '';
          return (
            <div
              key={col.key}
              className={`${styles.cell}${kindClass}${birthMarker ? ` ${styles.birthMarker}` : ''}${selClass}`}
              style={{ left: NAME_COL_W + col.start, width: col.size }}
              data-year={year}
              data-kind={value.kind}
              data-birth-marker={birthMarker ? 'true' : undefined}
              data-death-marker={deathMarker ? 'true' : undefined}
            >
              {cellText(value)}
              {deathMarker && <span className={styles.deathMark} />}
            </div>
          );
        }
        const value = cellValue(person, year, currentYear);
        const tooltip = cellTooltip(person, year, value);
        const kindClass =
          value.kind === 'alive' ? ` ${styles.alive}` : value.kind === 'virtual' ? ` ${styles.virtual}` : '';
        // 選択列の強調（ui-timeline-grid.md 4章）: 全セルに左右インセット罫線、空欄セルは背景も
        const selClass =
          year === selectedYear
            ? ` ${styles.selcol}${value.kind === 'blank' ? ` ${styles.selcolBlank}` : ''}`
            : '';
        return (
          <div
            key={col.key}
            className={`${styles.cell}${kindClass}${selClass}${columnRuleClass(year, currentYear)}`}
            style={{ left: NAME_COL_W + col.start, width: col.size }}
            data-year={year}
            data-kind={value.kind}
            title={tooltip}
          >
            {cellText(value)}
          </div>
        );
      })}
    </div>
  );
});

// 検索の巡回スクロール要求（TASK-109）。seq は「同じ人物への再スクロール」も発火させる
// ための単調増加トークン（ヒット1件で〔次へ〕を押した場合など）
export type SearchScrollRequest = { personId: string; seq: number };

export function TimelineGrid({
  timeline,
  filterTags,
  searchHitIds,
  searchScroll,
  onEditPerson,
  onDeletePerson,
  onAddEventAtYear,
  onEditEvent,
  onDeleteEvent,
}: {
  timeline: Timeline;
  // タグ絞り込みの選択集合（TASK-110）。OR条件で行（人物）とイベントレーンの両方に適用する。
  // 選択0個 = 全件（domain/query.ts filterByTags / filterEventsByTags）
  filterTags: string[];
  // 検索ヒット行の person id（表示行順。強調表示に使う。TASK-109）。
  // 検索は絞り込みではないため行の集合・順序には影響しない（ui-timeline-grid.md 6章）
  searchHitIds: readonly string[];
  // 検索の〔前へ/次へ〕・クエリ確定によるスクロール要求（null = 要求なし）
  searchScroll: SearchScrollRequest | null;
  // 行メニューの〔編集〕〔削除〕。ダイアログの状態は AppShell（ReadyContent）が持つ
  onEditPerson: (personId: string) => void;
  onDeletePerson: (personId: string) => void;
  // 年ヘッダー右クリック〔この年にイベント追加〕→ イベントフォーム（年を初期値に。TASK-106）
  onAddEventAtYear: (year: StoredYear) => void;
  // サイドパネルのイベント行〔編集〕〔削除〕（TASK-107 → TASK-106 のフォーム/確認ダイアログ）
  onEditEvent: (eventId: string) => void;
  onDeleteEvent: (eventId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  const [yearMenu, setYearMenu] = useState<YearMenuState | null>(null);
  // 選択列（US-004）。チップ / バッジ / 年ヘッダーのクリックで設定、Esc / ✕ で解除。
  // 10年ズームでは「列の年 = 区間の開始年」を持つ（columnYear と同じ規則）
  const [selectedYear, setSelectedYear] = useState<StoredYear | null>(null);
  // GridRow は memo 化されているため、行へ渡すコールバックは安定参照にする
  const openMenu = useCallback((personId: string, x: number, y: number) => {
    setMenu({ personId, x, y });
  }, []);
  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);
  const closeYearMenu = useCallback(() => {
    setYearMenu(null);
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedYear(null);
  }, []);

  // Esc で選択解除（ui-timeline-grid.md 4章）。ただしダイアログ・コンテキストメニューが
  // 開いている間はそちらの Esc（最前面を閉じる）を優先し、選択は維持する
  useEffect(() => {
    if (selectedYear === null) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !hasOpenDialog() && menu === null && yearMenu === null) {
        setSelectedYear(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedYear, menu, yearMenu]);

  // 現在年 = 実行時のシステム日付の年（glossary.md「現在年」）。セッション中は固定でよい
  // （年またぎの瞬間の追随は要件にない）
  const currentYear = useMemo(() => new Date().getFullYear() as StoredYear, []);

  // 表示行 = 並び替え + タグ絞り込み済み人物の配列（persons → sort → tagFilter → 表示行。
  // domain-logic.md 2章のパイプライン。導出は domain/query.ts。ADR 0003 / TASK-110）
  const persons = useMemo(() => {
    const byId = new Map(timeline.persons.map((p) => [p.id, p]));
    return visibleRowIds(timeline, filterTags).flatMap((id) => {
      const person = byId.get(id);
      return person === undefined ? [] : [person];
    });
  }, [timeline, filterTags]);

  const zoom = timeline.view.zoom;
  const columns = useMemo(() => gridColumns(timeline, currentYear), [timeline, currentYear]);

  // イベントの列集計（キー = astro 年（1年）/ decadeStart（10年）。列内は月日→名前順。
  // domain/query.ts）。入力はタグ絞り込み後のイベント（人物と対称の OR 条件。TASK-110）
  const eventColumns = useMemo(
    () => eventsByColumn(visibleEvents(timeline.events, filterTags), zoom),
    [timeline.events, filterTags, zoom],
  );

  const rowVirtualizer = useVirtualizer({
    count: persons.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CELL_H,
    overscan: OVERSCAN,
    // 並び替え・絞り込みで index が変わっても行の同一性を保つ（React key の安定化）
    getItemKey: (index) => persons[index]?.id ?? index,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => columnWidth(columns),
    overscan: OVERSCAN,
    // key = astro年（10年ズームは decadeStart）。範囲変更で index がずれても列の同一性を保つ
    getItemKey: (index) => columnKeyAstro(columns, index),
  });

  // ズーム切替時の中心年保持（US-007 / ui-timeline-grid.md 5章）。
  // 切替後の DOM は幅が縮んで scrollLeft がクランプされうるため、スクロールイベントで
  // 追跡した「切替前の scrollLeft」から中心年を求める（paint 前の layout effect で処理する）
  const scrollLeftRef = useRef(0);
  const prevViewRef = useRef<{ zoom: ZoomLevel; columns: GridColumns } | null>(null);
  useLayoutEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = { zoom, columns };
    if (prev === null || prev.zoom === zoom) {
      return;
    }
    const el = scrollRef.current;
    if (el === null) {
      return;
    }
    const center = centerYearAstro(prev.columns, scrollLeftRef.current, el.clientWidth);
    // 列幅 44⇔72 の変更を仮想化のサイズキャッシュへ反映してから位置を再計算する
    columnVirtualizer.measure();
    const left = scrollLeftForCenterYear(columns, center, el.clientWidth);
    el.scrollLeft = left;
    scrollLeftRef.current = left;
    // 選択列は列の意味（年 ⇔ 10年区間）が変わるため解除する
    setSelectedYear(null);
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = columnVirtualizer.getVirtualItems();
  // 人物列(200px)は仮想化の座標系の外（左に固定）。列座標は一律 NAME_COL_W だけずらす。
  // 総幅は列数×列幅で確定計算する（切替直後の仮想化キャッシュの古い実測に依存させない）
  const totalWidth = NAME_COL_W + columns.count * columnWidth(columns);

  // 年齢比較行クリック → その人物の行を可視範囲の中央へスクロール（ui-timeline-grid.md 4章）
  const scrollToPerson = useCallback(
    (personId: string) => {
      const index = persons.findIndex((p) => p.id === personId);
      if (index >= 0) {
        rowVirtualizer.scrollToIndex(index, { align: 'center' });
      }
    },
    [persons, rowVirtualizer],
  );

  // 検索ヒットの強調（TASK-109）。ヒット集合の変化はまれなので Set 化して行ごとに判定する
  const searchHitSet = useMemo(() => new Set(searchHitIds), [searchHitIds]);

  // 検索のスクロール要求（クエリ確定・〔前へ/次へ〕）に応答する。要求（seq）が来たときだけ
  // 動かし、データ変化では動かさない（ヒット0件時はそもそも要求が来ない = 位置不変）
  useEffect(() => {
    if (searchScroll !== null) {
      scrollToPerson(searchScroll.personId);
    }
    // scrollToPerson（persons 由来）は依存に含めない: データ変化での勝手な再スクロールを防ぐ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchScroll]);

  return (
    <>
    <div
      ref={scrollRef}
      className={styles.scroll}
      data-testid="timeline-grid"
      onScroll={(event) => {
        // ズーム切替時に「切替前の scrollLeft」を参照するための追跡（layout effect 参照）
        scrollLeftRef.current = event.currentTarget.scrollLeft;
      }}
    >
      <div className={styles.inner} style={{ width: totalWidth }}>
        {/* 年ヘッダー（上に sticky）。クリックで列選択（ui-timeline-grid.md 3章）。
            10年ズームの見出しは "1600〜" 形式・罫線ガイドなし（screen-02） */}
        <div className={styles.yearHeader} style={{ height: YEAR_HEADER_H }}>
          <div className={styles.cornerCell} style={{ width: NAME_COL_W }}>
            人物
          </div>
          {virtualCols.map((col) => {
            const year = columnYear(columns, col.index);
            const isDecade = columns.zoom === 'decade';
            const selClass = year === selectedYear ? ` ${styles.yearCellSel}` : '';
            const ruleClass = isDecade ? '' : columnRuleClass(year, currentYear);
            const label = isDecade
              ? `${decadeRangeLabel(columnKeyAstro(columns, col.index))}年`
              : `${formatYear(year)}年`;
            return (
              <div
                key={col.key}
                className={`${styles.yearCell}${selClass}${ruleClass}`}
                style={{ left: NAME_COL_W + col.start, width: col.size }}
                data-year={year}
                role="button"
                tabIndex={0}
                aria-label={`${label}の列を選択`}
                onClick={() => setSelectedYear(year)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedYear(year);
                  }
                }}
                onContextMenu={
                  isDecade
                    ? undefined // 10年列は特定の年を指せないため年メニューは出さない
                    : (event) => {
                        // 右クリック〔この年にイベント追加〕（ui-forms-dialogs.md 2章）
                        event.preventDefault();
                        setYearMenu({ year, x: event.clientX, y: event.clientY });
                      }
                }
              >
                {columnLabel(columns, col.index)}
              </div>
            );
          })}
        </div>
        {/* イベントレーン（年ヘッダー直下に sticky。ui-timeline-grid.md 3章 / screen-01 .event-lane。
            10年ズームは件数バッジ「n件」のみ・高さ1段（ui-timeline-grid.md 5章 / screen-02 .ev-badge） */}
        <div
          className={styles.eventLane}
          style={{
            height: columns.zoom === 'decade' ? EVENT_LANE_H_DECADE : EVENT_LANE_H,
            top: YEAR_HEADER_H,
          }}
          data-testid="event-lane"
        >
          <div className={styles.laneCorner} style={{ width: NAME_COL_W }}>
            イベント
          </div>
          {virtualCols.map((col) => {
            const year = columnYear(columns, col.index);
            const colEvents = eventColumns.get(columnKeyAstro(columns, col.index));
            const selClass = year === selectedYear ? ` ${styles.evColSel}` : '';
            if (columns.zoom === 'decade') {
              const count = colEvents?.length ?? 0;
              return (
                <div
                  key={col.key}
                  className={`${styles.evCol} ${styles.evColDecade}${selClass}`}
                  style={{ left: NAME_COL_W + col.start, width: col.size }}
                  data-year={year}
                  role="button"
                  tabIndex={count > 0 ? 0 : -1}
                  aria-label={`${decadeRangeLabel(columnKeyAstro(columns, col.index))}年のイベント列を選択`}
                  onClick={() => setSelectedYear(year)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedYear(year);
                    }
                  }}
                >
                  {count > 0 && <div className={styles.countBadge}>{count}件</div>}
                </div>
              );
            }
            const lane = laneColumn(colEvents);
            return (
              <div
                key={col.key}
                className={`${styles.evCol}${selClass}`}
                style={{ left: NAME_COL_W + col.start, width: col.size }}
                data-year={year}
                role="button"
                tabIndex={lane.chips.length > 0 ? 0 : -1}
                aria-label={`${formatYear(year)}年のイベント列を選択`}
                onClick={() => setSelectedYear(year)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedYear(year);
                  }
                }}
              >
                {lane.chips.map((laneEvent) => (
                  <div
                    key={laneEvent.id}
                    className={styles.chip}
                    style={chipColors(laneEvent)}
                    title={chipTooltip(laneEvent)}
                    data-event-id={laneEvent.id}
                  >
                    {laneEvent.personId !== undefined && <span className={styles.pico}>👤</span>}
                    {laneEvent.name}
                  </div>
                ))}
                {lane.moreCount > 0 && (
                  <div className={styles.moreBadge}>+{lane.moreCount}</div>
                )}
              </div>
            );
          })}
        </div>
        <div className={styles.body} style={{ height: rowVirtualizer.getTotalSize() }}>
          {virtualRows.map((row) => {
            const person = persons[row.index];
            if (person === undefined) {
              return null; // 到達しない（count = persons.length）が、型上の防御
            }
            return (
              <GridRow
                key={row.key}
                person={person}
                top={row.start}
                columns={columns}
                virtualCols={virtualCols}
                currentYear={currentYear}
                selectedYear={selectedYear}
                searchHit={searchHitSet.has(person.id)}
                onOpenMenu={openMenu}
              />
            );
          })}
        </div>
      </div>
      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} ariaLabel="人物メニュー" onClose={closeMenu}>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              setMenu(null);
              onEditPerson(menu.personId);
            }}
          >
            編集
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={() => {
              setMenu(null);
              onDeletePerson(menu.personId);
            }}
          >
            削除
          </button>
        </ContextMenu>
      )}
      {yearMenu !== null && (
        <ContextMenu x={yearMenu.x} y={yearMenu.y} ariaLabel="年メニュー" onClose={closeYearMenu}>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              setYearMenu(null);
              onAddEventAtYear(yearMenu.year);
            }}
          >
            この年にイベント追加
          </button>
        </ContextMenu>
      )}
    </div>
    {/* サイドパネルはグリッドの右に横並び（AppShell の .main が flex の器。screen-01 .main）。
        10年ズームでは選択列 = 10年区間（selectedYear = 区間の開始年。eventsAtYear の
        toAstro(開始年) が eventsByColumn の decadeStart キーと一致する） */}
    {selectedYear !== null && (
      <SidePanel
        // 年・ズームが変わったら展開状態ごと作り直す（前の選択の展開を持ち越さない）
        key={`${zoom}:${selectedYear}`}
        zoom={zoom}
        year={selectedYear}
        events={eventsAtYear(eventColumns, selectedYear)}
        persons={persons}
        currentYear={currentYear}
        onClose={clearSelection}
        onEditEvent={onEditEvent}
        onDeleteEvent={onDeleteEvent}
        onPersonClick={scrollToPerson}
      />
    )}
    </>
  );
}
