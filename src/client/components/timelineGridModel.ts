// TimelineGrid の描画用の純粋な導出ロジック（ui-timeline-grid.md 1〜2章 / ADR 0003）。
// コンポーネント（React・DOM）から分離して単体テスト可能にする。現在年は引数で受け取る
// （Date を読むのはコンポーネント側。domain の純粋性規約と同じ流儀）。

import { autoRange } from '../../domain/query';
import type { Person } from '../../domain/schema';
import type { Timeline } from '../../domain/schema';
import {
  formatYear,
  fromAstro,
  toAstro,
  type AstroYear,
  type CellValue,
  type StoredYear,
} from '../../domain/year';

// 寸法（px）。値は design-tokens.md / tokens.css の寸法トークンと同値に保つ
// （正はトークン表）。仮想化の座標計算(JS)とレイアウトの両方が使うため、
// CSS には書かずここからインラインスタイルで与える（数値の二重管理をしない）。
export const CELL_W = 44; // --cell-w（1年ズームの列幅）
export const CELL_H = 28; // --cell-h（行高）
export const NAME_COL_W = 200; // --name-col-w（人物列幅）
export const YEAR_HEADER_H = 32; // screen-01 .year-header の高さ
export const OVERSCAN = 5; // 行・列とも（ui-timeline-grid.md 1章）

// 列 index ↔ 年の対応。0年が存在しない StoredYear のままでは index が不連続になるため、
// 連続整数軸の astro 年で持つ（ADR 0004）
export type GridColumns = { startAstro: AstroYear; count: number };

// 実効範囲 = view.startYear ?? autoRange().start 〜 view.endYear ?? autoRange().end
// （domain-logic.md 2章。開始・終了は独立に手動指定できる）
export function gridColumns(timeline: Timeline, currentYear: StoredYear): GridColumns {
  const auto = autoRange(timeline, currentYear);
  const startAstro = toAstro(timeline.view.startYear ?? auto.start);
  const endAstro = toAstro(timeline.view.endYear ?? auto.end);
  // 反転指定（開始 > 終了）はフォーム側で拒否される（E-RANGE-INVERTED）。防御として1列に留める
  return { startAstro, count: Math.max(endAstro - startAstro, 0) + 1 };
}

export function columnYear(columns: GridColumns, index: number): StoredYear {
  return fromAstro((columns.startAstro + index) as AstroYear);
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
