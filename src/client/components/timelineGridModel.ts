// TimelineGrid の描画用の純粋な導出ロジック（ui-timeline-grid.md 1〜2章 / ADR 0003）。
// コンポーネント（React・DOM）から分離して単体テスト可能にする。現在年は引数で受け取る
// （Date を読むのはコンポーネント側。domain の純粋性規約と同じ流儀）。

import { autoRange } from '../../domain/query';
import type { Person } from '../../domain/schema';
import type { Timeline } from '../../domain/schema';
import {
  decadeEnd,
  decadeStart,
  formatDecade,
  formatYear,
  fromAstro,
  toAstro,
  type AstroYear,
  type CellValue,
  type PersonLifespan,
  type StoredYear,
} from '../../domain/year';

// 寸法（px）。値は design-tokens.md / tokens.css の寸法トークンと同値に保つ
// （正はトークン表）。仮想化の座標計算(JS)とレイアウトの両方が使うため、
// CSS には書かずここからインラインスタイルで与える（数値の二重管理をしない）。
export const CELL_W = 44; // --cell-w（1年ズームの列幅）
export const CELL_W_DECADE = 72; // --cell-w-decade（10年ズームの列幅）
export const CELL_H = 28; // --cell-h（行高）
export const NAME_COL_W = 200; // --name-col-w（人物列幅）
export const YEAR_HEADER_H = 32; // screen-01 .year-header の高さ
export const EVENT_LANE_H = 56; // --event-lane-h（イベントレーン高。チップ2段）
export const EVENT_LANE_H_DECADE = 28; // screen-02 .event-lane の高さ（バッジ1段）
export const OVERSCAN = 5; // 行・列とも（ui-timeline-grid.md 1章）

export type ZoomLevel = Timeline['view']['zoom']; // 'year' | 'decade'（US-007）

// 列 index ↔ 年の対応。0年が存在しない StoredYear のままでは index が不連続になるため、
// 連続整数軸の astro 年で持つ（ADR 0004）。10年ズームでは startAstro = 先頭列の
// decadeStart（列 index との対応は decadeOrdinal 経由。西暦1〜9の9年バケットを挟むため）
export type GridColumns = { zoom: ZoomLevel; startAstro: AstroYear; count: number };

// 10年列の連番。隣接するバケットの差が常に1になる全単射で、9年バケット（西暦1〜9 =
// ordinal 0）を挟んでも「index = ordinal 差」の算術が壊れないようにする
function decadeOrdinal(dStart: AstroYear): number {
  return dStart >= 10 ? dStart / 10 : dStart === 1 ? 0 : (dStart - 1) / 10;
}

function decadeStartOfOrdinal(ordinal: number): AstroYear {
  return (ordinal >= 1 ? ordinal * 10 : ordinal === 0 ? 1 : ordinal * 10 + 1) as AstroYear;
}

// 実効範囲 = view.startYear ?? autoRange().start 〜 view.endYear ?? autoRange().end
// （domain-logic.md 2章。開始・終了は独立に手動指定できる）。
// 10年ズームは範囲の両端を含む decadeStart バケットの列にする（domain-logic.md 1章）
export function gridColumns(timeline: Timeline, currentYear: StoredYear): GridColumns {
  const auto = autoRange(timeline, currentYear);
  const startAstro = toAstro(timeline.view.startYear ?? auto.start);
  const endAstro = toAstro(timeline.view.endYear ?? auto.end);
  const zoom = timeline.view.zoom;
  if (zoom === 'decade') {
    const firstStart = decadeStart(startAstro);
    // 反転指定はフォーム側で拒否される（E-RANGE-INVERTED）。1年ズームと同じ防御で1列に留める
    const count =
      Math.max(decadeOrdinal(decadeStart(endAstro)) - decadeOrdinal(firstStart), 0) + 1;
    return { zoom, startAstro: firstStart, count };
  }
  // 反転指定（開始 > 終了）はフォーム側で拒否される（E-RANGE-INVERTED）。防御として1列に留める
  return { zoom, startAstro, count: Math.max(endAstro - startAstro, 0) + 1 };
}

// 列の識別キー（= 仮想化の item key・eventsByColumn のキー）。
// 1年 = その年の astro 年、10年 = その区間の decadeStart（query.ts の集計キーと同一規則）
export function columnKeyAstro(columns: GridColumns, index: number): AstroYear {
  return columns.zoom === 'decade'
    ? decadeStartOfOrdinal(decadeOrdinal(columns.startAstro) + index)
    : ((columns.startAstro + index) as AstroYear);
}

// 列の年（10年ズームでは区間の開始年）。選択列の状態・data-year 属性はこの値で持つ
export function columnYear(columns: GridColumns, index: number): StoredYear {
  return fromAstro(columnKeyAstro(columns, index));
}

export function columnWidth(columns: GridColumns): number {
  return columns.zoom === 'decade' ? CELL_W_DECADE : CELL_W;
}

// 年ヘッダーの見出し（1年 = "1600"（screen-01）、10年 = "1600〜"/"前1000〜"/"1〜"（screen-02））
export function columnLabel(columns: GridColumns, index: number): string {
  return columns.zoom === 'decade'
    ? formatDecade(columnKeyAstro(columns, index))
    : formatYear(columnYear(columns, index));
}

// 10年区間の全範囲表記（"1600〜1609" / "前1000〜前991" / "1〜9"。
// パネル見出し等（ui-timeline-grid.md 4章）と aria-label 用）
export function decadeRangeLabel(dStart: AstroYear): string {
  return `${formatYear(fromAstro(dStart))}〜${formatYear(fromAstro(decadeEnd(dStart)))}`;
}

// 10年セルの集約値（ui-timeline-grid.md 5章 / screen-02 で確認した集約表現）:
// - 区間のいずれかの年で alive → alive。数値は区間開始年の年齢（開始年より後の生まれは 0）
// - 区間の全年が生前 → blank
// - それ以外（全年が没後 / 存命者の未来年） → virtual（開始年の仮想年齢）
// - 生年を含む区間は左端マーカー、没年を含む区間は右端マーカー（帯の端の視認）
export type DecadeCellValue =
  | { kind: 'blank' }
  | { kind: 'alive'; age: number; birthMarker: boolean; deathMarker: boolean }
  | { kind: 'virtual'; age: number };

export function decadeCellValue(
  person: PersonLifespan,
  dStart: AstroYear,
  currentYear: StoredYear,
): DecadeCellValue {
  const dEnd = decadeEnd(dStart);
  const birthAstro = toAstro(person.birth.year);
  if (dEnd < birthAstro) {
    return { kind: 'blank' }; // 区間の全年が生前
  }
  // alive な年の区間 = [生年, 没年 or 現在年]（cellValue の判定規則1〜4と同値。
  // 没年なしで生年が現在年より未来なら空区間 = alive な年が1つも無い）
  const aliveEndAstro =
    person.death === undefined ? toAstro(currentYear) : toAstro(person.death.year);
  const age = Math.max(dStart - birthAstro, 0); // 開始年より後の生まれは 0（5章）
  if (dStart > aliveEndAstro || aliveEndAstro < birthAstro) {
    return { kind: 'virtual', age };
  }
  return {
    kind: 'alive',
    age,
    birthMarker: birthAstro >= dStart, // birthAstro <= dEnd は blank 判定で確定済み
    deathMarker: person.death !== undefined && toAstro(person.death.year) <= dEnd, // >= dStart は alive 判定で確定済み
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ===== ズーム切替時の中心年保持（ui-timeline-grid.md 5章 / US-007 受け入れ条件） =====
// 人物列（NAME_COL_W）は左 sticky でセル座標系の外に固定されるため、
// セル可視域の中心（セル座標系） = scrollLeft + (ビューポート幅 − NAME_COL_W) / 2。

// 可視範囲の中心にある「年」（astro）。10年列は列内の横位置を年に比例配分し、
// 1年→10年→1年と往復しても中心年が丸めで大きくずれないようにする
export function centerYearAstro(
  columns: GridColumns,
  scrollLeft: number,
  viewportWidth: number,
): AstroYear {
  const width = columnWidth(columns);
  const centerX = scrollLeft + Math.max(viewportWidth - NAME_COL_W, 0) / 2;
  const position = centerX / width; // 列 index + 列内位置（小数部）
  const index = clamp(Math.floor(position), 0, columns.count - 1);
  const keyAstro = columnKeyAstro(columns, index);
  if (columns.zoom === 'year') {
    return keyAstro;
  }
  const span = decadeEnd(keyAstro) - keyAstro + 1; // 10（西暦1〜9のみ9）
  const offset = clamp(Math.floor((position - index) * span), 0, span - 1);
  return (keyAstro + offset) as AstroYear;
}

// 指定した年が可視範囲の中心に来る scrollLeft（コンテンツ幅・0 でクランプ）
export function scrollLeftForCenterYear(
  columns: GridColumns,
  yearAstro: AstroYear,
  viewportWidth: number,
): number {
  const width = columnWidth(columns);
  let cellCenterX: number;
  if (columns.zoom === 'year') {
    const index = clamp(yearAstro - columns.startAstro, 0, columns.count - 1);
    cellCenterX = index * width + width / 2;
  } else {
    const index = clamp(
      decadeOrdinal(decadeStart(yearAstro)) - decadeOrdinal(columns.startAstro),
      0,
      columns.count - 1,
    );
    const dStart = columnKeyAstro(columns, index);
    const span = decadeEnd(dStart) - dStart + 1;
    const offset = clamp(yearAstro - dStart, 0, span - 1);
    cellCenterX = index * width + ((offset + 0.5) / span) * width;
  }
  const target = cellCenterX - Math.max(viewportWidth - NAME_COL_W, 0) / 2;
  const maxScroll = Math.max(NAME_COL_W + columns.count * width - viewportWidth, 0);
  return clamp(target, 0, maxScroll);
}

// セル本文（US-002 / NFR: 色だけに頼らない二重チャネル。仮想年齢は括弧書式が
// 色以外の識別チャネルになる。design-tokens.md「生存/仮想の識別設計」）
export function cellText(value: CellValue): string {
  switch (value.kind) {
    case 'blank':
      return '';
    case 'alive':
      return String(value.age);
    case 'virtual':
      return `(${value.age})`;
  }
}

// セルのホバーツールチップ（文言の正は screen-01 の title。blank はツールチップなし）。
// 没年のない人物の virtual（存命者の未来年）はモックアップに例がないため
// 「没後・」を外した同型の文言にする
export function cellTooltip(
  person: Person,
  year: StoredYear,
  value: CellValue,
): string | undefined {
  if (value.kind === 'blank') {
    return undefined;
  }
  if (value.kind === 'alive') {
    return `${formatYear(year)}年 ${person.name} ${value.age}歳（生存中）`;
  }
  return person.death !== undefined
    ? `${formatYear(year)}年 ${person.name}（没後・生きていれば${value.age}歳）`
    : `${formatYear(year)}年 ${person.name}（生きていれば${value.age}歳）`;
}

// 人物列の生没年併記（例「1543–1616」。存命は「1543–」。screen-01 の .yrs）
export function lifespanLabel(person: Person): string {
  const death = person.death === undefined ? '' : formatYear(person.death.year);
  return `${formatYear(person.birth.year)}–${death}`;
}

// 人物列のホバーツールチップ（タグ名の全件表示。screen-01 の name-cell title）
export function personTooltip(person: Person): string {
  return `タグ: ${person.tags.length > 0 ? person.tags.join('、') : 'なし'}`;
}

// 10の倍数年の縦罫線ガイド（ui-timeline-grid.md 2章）。紀元前も表示ラベルの倍数で判定
// （前100 = -100 はガイド。ラベル整列は decadeStart と同じ考え方）
export function isDecadeGuideYear(year: StoredYear): boolean {
  return year % 10 === 0;
}
