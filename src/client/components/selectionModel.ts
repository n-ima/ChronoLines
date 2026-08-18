// 選択列まわり（イベントレーン・年齢比較サイドパネル）の純粋な導出ロジック
// （ui-timeline-grid.md 3〜4章 / screen-01 / US-003・US-004 = コアバリュー）。
// コンポーネント（React・DOM）から分離して単体テスト可能にする。現在年は引数で受け取る
// （timelineGridModel.ts と同じ流儀）。

import type { Person, TimelineEvent } from '../../domain/schema';
import { cellValue, formatYear, toAstro, type CellValue, type StoredYear } from '../../domain/year';
import { tagPillColors } from '../tagColor';
import { decadeCellValue, decadeRangeLabel, type ZoomLevel } from './timelineGridModel';

// 列ごとのチップ最大数。3件以上は「+N」バッジに集約する（ui-timeline-grid.md 3章）
export const MAX_LANE_CHIPS = 2;

export type LaneColumn = { chips: TimelineEvent[]; moreCount: number };

// eventsByColumn の1列分をレーン表示（先頭から最大2チップ + +N バッジ）に集約する。
// 入力の並び（年内の月日→名前順）は eventsByColumn が保証するためここでは並べ替えない
export function laneColumn(events: readonly TimelineEvent[] | undefined): LaneColumn {
  const all = events ?? [];
  return {
    chips: all.slice(0, MAX_LANE_CHIPS),
    moreCount: Math.max(all.length - MAX_LANE_CHIPS, 0),
  };
}

// チップの配色: タグを持つ場合は先頭タグのタグ配色、タグなしは既定のアンバー
// （--color-chip-bg/-text。ui-timeline-grid.md 3章 / design-tokens.md）
export function chipColors(event: TimelineEvent): { background: string; color: string } {
  const firstTag = event.tags[0];
  return firstTag === undefined
    ? { background: 'var(--color-chip-bg)', color: 'var(--color-chip-text)' }
    : tagPillColors(firstTag);
}

// チップのホバーツールチップ（screen-01: 「関ヶ原の戦い（合戦）」。タグなしは名前のみ）
export function chipTooltip(event: TimelineEvent): string {
  return event.tags.length > 0 ? `${event.name}（${event.tags.join('、')}）` : event.name;
}

// パネル見出し（1年ズーム: 「1600年」「前100年」）
export function panelYearLabel(year: StoredYear): string {
  return `${formatYear(year)}年`;
}

// パネル見出しのズーム対応（ui-timeline-grid.md 4章: 10年ズーム時は範囲「1600〜1609」。
// year は選択列の年 = 10年ズームでは区間の開始年）
export function panelColumnLabel(zoom: ZoomLevel, year: StoredYear): string {
  return zoom === 'decade' ? decadeRangeLabel(toAstro(year)) : panelYearLabel(year);
}

// パネルのイベント行に添える月日（月のみ「9月」・月日「9月15日」・無指定は null = 非表示）
export function eventDateLabel(event: TimelineEvent): string | null {
  if (event.month === undefined) {
    return null;
  }
  return event.day === undefined ? `${event.month}月` : `${event.month}月${event.day}日`;
}

// 選択列のイベント全件（eventsByColumn の結果から。列キーは astro 年）
export function eventsAtYear(
  columns: Map<number, TimelineEvent[]>,
  year: StoredYear,
): TimelineEvent[] {
  return columns.get(toAstro(year)) ?? [];
}

// 年齢比較リスト（US-004）: グリッドの行順の persons をそのまま受け取り、当該年の
// CellValue を並べる。判定はセルと同一（cellValue を共用）= 「セルと同じ色書式」の根拠
export type AgeRow = { person: Person; value: CellValue };

export function ageRows(
  persons: readonly Person[],
  year: StoredYear,
  currentYear: StoredYear,
): AgeRow[] {
  return persons.map((person) => ({ person, value: cellValue(person, year, currentYear) }));
}

// 10年ズームの年齢比較リスト: セル（decadeCellValue）と同じ判定・同じ書式
// （数値は区間開始年時点。dStartYear = 区間の開始年の stored 表現 = 選択列の年）
export function decadeAgeRows(
  persons: readonly Person[],
  dStartYear: StoredYear,
  currentYear: StoredYear,
): AgeRow[] {
  const dStart = toAstro(dStartYear);
  return persons.map((person) => {
    const value = decadeCellValue(person, dStart, currentYear);
    return {
      person,
      value: value.kind === 'alive' ? { kind: 'alive', age: value.age } : value,
    };
  });
}

// 10年列のイベントの年別グループ（ui-timeline-grid.md 5章「パネルに年別グループで全件表示」）。
// 入力は eventsByColumn の1列分 = (年, 月, 日, 名前) 昇順ソート済みなので、
// 出現順のまま年で区切るだけで順序が保たれる
export type YearGroup = { year: StoredYear; events: TimelineEvent[] };

export function groupEventsByYear(events: readonly TimelineEvent[]): YearGroup[] {
  const groups: YearGroup[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.year === event.year) {
      last.events.push(event);
    } else {
      groups.push({ year: event.year, events: [event] });
    }
  }
  return groups;
}

// 年齢比較行の表示文字列（alive/virtual はセルと同じ書式。blank は「—（生前）」=
// screen-01 renderPanel の文言。括弧が色以外の識別チャネルである点もセルと同じ）
export function ageRowText(value: CellValue): string {
  switch (value.kind) {
    case 'blank':
      return '—（生前）';
    case 'alive':
      return String(value.age);
    case 'virtual':
      return `(${value.age})`;
  }
}
