// 年表グリッド（TASK-104: 1年ズーム。ui-timeline-grid.md 1〜2章 / ADR 0003 / screen-01）。
// 行(人物)・列(年)に @tanstack/react-virtual の virtualizer を1つずつ使い、可視窓 +
// オーバースキャン5 のセルだけを DOM に実体化する。セル値は描画時に cellValue で
// 都度計算し、300万セル分の配列・キャッシュ・巨大 useMemo を作らない（ADR 0003）。
// イベントレーン・選択列・サイドパネル（TASK-107）は年ヘッダー直下・グリッド右に、
// 10年ズーム（TASK-108）は列軸の置き換えとして差し込む構成とし、ここでは作らない。
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { sortedPersonIds } from '../../domain/query';
import type { Person, Timeline } from '../../domain/schema';
import { cellValue, formatYear, type StoredYear } from '../../domain/year';
import { tagDotColor } from '../tagColor';
import styles from './TimelineGrid.module.css';
import {
  CELL_H,
  CELL_W,
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

// 行メニュー（人物列の行クリックで開く。ui-forms-dialogs.md 1章「行メニュー〔編集〕〔削除〕」）
type RowMenuState = { personId: string; x: number; y: number };

const ROW_MENU_W = 160; // 画面端でのはみ出しクランプ用（.rowMenu の min-width と同値）
const ROW_MENU_H = 80;

function RowMenu({
  menu,
  onEdit,
  onDelete,
  onClose,
}: {
  menu: RowMenuState;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
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
  const left = Math.max(0, Math.min(menu.x, window.innerWidth - ROW_MENU_W));
  const top = Math.max(0, Math.min(menu.y, window.innerHeight - ROW_MENU_H));
  return (
    // 透明バックドロップ: メニュー外クリックで閉じる（クリックは下の要素へ通さない）
    <div className={styles.menuBackdrop} onMouseDown={onClose}>
      <div
        className={styles.rowMenu}
        style={{ left, top }}
        role="menu"
        aria-label="人物メニュー"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onEdit}>
          編集
        </button>
        <button
          type="button"
          role="menuitem"
          className={`${styles.menuItem} ${styles.menuItemDanger}`}
          onClick={onDelete}
        >
          削除
        </button>
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
        return (
          <div
            key={col.key}
            className={`${styles.cell}${kindClass}${columnRuleClass(year, currentYear)}`}
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
}: {
  timeline: Timeline;
  // 行メニューの〔編集〕〔削除〕。ダイアログの状態は AppShell（ReadyContent）が持つ
  onEditPerson: (personId: string) => void;
  onDeletePerson: (personId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  // GridRow は memo 化されているため、行へ渡すコールバックは安定参照にする
  const openMenu = useCallback((personId: string, x: number, y: number) => {
    setMenu({ personId, x, y });
  }, []);
  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

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

  return (
    <div ref={scrollRef} className={styles.scroll} data-testid="timeline-grid">
      <div className={styles.inner} style={{ width: totalWidth }}>
        {/* 年ヘッダー（上に sticky）。イベントレーン（TASK-107）はこの直下に同じ sticky 構成で差し込む */}
        <div className={styles.yearHeader} style={{ height: YEAR_HEADER_H }}>
          <div className={styles.cornerCell} style={{ width: NAME_COL_W }}>
            人物
          </div>
          {virtualCols.map((col) => {
            const year = columnYear(columns, col.index);
            return (
              <div
                key={col.key}
                className={`${styles.yearCell}${columnRuleClass(year, currentYear)}`}
                style={{ left: NAME_COL_W + col.start, width: col.size }}
                data-year={year}
              >
                {formatYear(year)}
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
                onOpenMenu={openMenu}
              />
            );
          })}
        </div>
      </div>
      {menu !== null && (
        <RowMenu
          menu={menu}
          onClose={closeMenu}
          onEdit={() => {
            setMenu(null);
            onEditPerson(menu.personId);
          }}
          onDelete={() => {
            setMenu(null);
            onDeletePerson(menu.personId);
          }}
        />
      )}
    </div>
  );
}
