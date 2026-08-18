// 年表グリッド（TASK-104: 1年ズーム。ui-timeline-grid.md 1〜2章 / ADR 0003 / screen-01）。
// 行(人物)・列(年)に @tanstack/react-virtual の virtualizer を1つずつ使い、可視窓 +
// オーバースキャン5 のセルだけを DOM に実体化する。セル値は描画時に cellValue で
// 都度計算し、300万セル分の配列・キャッシュ・巨大 useMemo を作らない（ADR 0003）。
// イベントレーン・選択列・サイドパネル（TASK-107: ui-timeline-grid.md 3〜4章）も本体で持つ
// （選択列の強調とパネルの年齢比較は行・列の状態を共有するため）。
// 10年ズーム（TASK-108）は列軸の置き換えとして差し込む構成とし、ここでは作らない。
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { eventsByColumn, sortedPersonIds } from '../../domain/query';
import type { Person, Timeline } from '../../domain/schema';
import { cellValue, formatYear, type StoredYear } from '../../domain/year';
import { tagDotColor } from '../tagColor';
import { hasOpenDialog } from './Dialog';
import { chipColors, chipTooltip, eventsAtYear, laneColumn } from './selectionModel';
import { SidePanel } from './SidePanel';
import styles from './TimelineGrid.module.css';
import {
  CELL_H,
  CELL_W,
  EVENT_LANE_H,
  NAME_COL_W,
  OVERSCAN,
  YEAR_HEADER_H,
  cellText,
  cellTooltip,
  columnYear,
  gridColumns,
  isDecadeGuideYear,
  lifespanLabel,
  personTooltip,
  type GridColumns,
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
  onOpenMenu,
}: GridRowProps) {
  return (
    <div className={styles.row} style={{ top, height: CELL_H }} data-person-id={person.id}>
      <div
        className={styles.nameCell}
        style={{ width: NAME_COL_W }}
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

export function TimelineGrid({
  timeline,
  onEditPerson,
  onDeletePerson,
  onAddEventAtYear,
  onEditEvent,
  onDeleteEvent,
}: {
  timeline: Timeline;
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
  // 選択列（US-004）。チップ / +N バッジ / 年ヘッダーのクリックで設定、Esc / ✕ で解除
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

  // 表示行 = 並び替え済み人物の配列（導出は domain/query.ts。ADR 0003）。
  // タグ絞り込み（filterByTags）は TASK-110 でこのパイプラインに挿入する
  const persons = useMemo(() => {
    const byId = new Map(timeline.persons.map((p) => [p.id, p]));
    return sortedPersonIds(timeline).flatMap((id) => {
      const person = byId.get(id);
      return person === undefined ? [] : [person];
    });
  }, [timeline]);

  const columns = useMemo(() => gridColumns(timeline, currentYear), [timeline, currentYear]);

  // イベントの列集計（キー = astro 年。列内は月日→名前順。domain/query.ts）。
  // タグ絞り込み（filterEventsByTags）は TASK-110 でこの入力に挿入する
  const eventColumns = useMemo(() => eventsByColumn(timeline.events, 'year'), [timeline.events]);

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
    estimateSize: () => CELL_W,
    overscan: OVERSCAN,
    // key = astro年。範囲変更で index がずれても列の同一性を保つ
    getItemKey: (index) => columns.startAstro + index,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = columnVirtualizer.getVirtualItems();
  // 人物列(200px)は仮想化の座標系の外（左に固定）。列座標は一律 NAME_COL_W だけずらす
  const totalWidth = NAME_COL_W + columnVirtualizer.getTotalSize();

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

  return (
    <>
    <div ref={scrollRef} className={styles.scroll} data-testid="timeline-grid">
      <div className={styles.inner} style={{ width: totalWidth }}>
        {/* 年ヘッダー（上に sticky）。クリックで列選択（ui-timeline-grid.md 3章） */}
        <div className={styles.yearHeader} style={{ height: YEAR_HEADER_H }}>
          <div className={styles.cornerCell} style={{ width: NAME_COL_W }}>
            人物
          </div>
          {virtualCols.map((col) => {
            const year = columnYear(columns, col.index);
            const selClass = year === selectedYear ? ` ${styles.yearCellSel}` : '';
            return (
              <div
                key={col.key}
                className={`${styles.yearCell}${selClass}${columnRuleClass(year, currentYear)}`}
                style={{ left: NAME_COL_W + col.start, width: col.size }}
                data-year={year}
                role="button"
                tabIndex={0}
                aria-label={`${formatYear(year)}年の列を選択`}
                onClick={() => setSelectedYear(year)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedYear(year);
                  }
                }}
                onContextMenu={(event) => {
                  // 右クリック〔この年にイベント追加〕（ui-forms-dialogs.md 2章）
                  event.preventDefault();
                  setYearMenu({ year, x: event.clientX, y: event.clientY });
                }}
              >
                {formatYear(year)}
              </div>
            );
          })}
        </div>
        {/* イベントレーン（年ヘッダー直下に sticky。ui-timeline-grid.md 3章 / screen-01 .event-lane） */}
        <div
          className={styles.eventLane}
          style={{ height: EVENT_LANE_H, top: YEAR_HEADER_H }}
          data-testid="event-lane"
        >
          <div className={styles.laneCorner} style={{ width: NAME_COL_W }}>
            イベント
          </div>
          {virtualCols.map((col) => {
            const year = columnYear(columns, col.index);
            const lane = laneColumn(eventColumns.get(columns.startAstro + col.index));
            const selClass = year === selectedYear ? ` ${styles.evColSel}` : '';
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
    {/* サイドパネルはグリッドの右に横並び（AppShell の .main が flex の器。screen-01 .main） */}
    {selectedYear !== null && (
      <SidePanel
        // 年が変わったら展開状態ごと作り直す（前の年の展開を持ち越さない）
        key={selectedYear}
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
