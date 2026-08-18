// 表示範囲指定と空状態のモデル（TASK-112 / ui-timeline-grid.md 7章 / domain-logic.md 2章 /
// US-006）。範囲入力の解釈（parseYearInput・E-RANGE-INVERTED）・実効範囲（view ?? autoRange）・
// 「範囲内に該当なし」バナーの判定・空の年表（空状態表示）の判定を純粋に扱う。
// React への配線（入力のコミット・setViewRange 呼び出し）は Toolbar / AppShell が担う。
import { autoRange } from '../../domain/query';
import type { Timeline } from '../../domain/schema';
import {
  compareStoredYears,
  formatYear,
  parseYearInput,
  toAstro,
  type StoredYear,
} from '../../domain/year';

export type RangeErrorCode = 'E-YEAR-FORMAT' | 'E-YEAR-ZERO' | 'E-RANGE-INVERTED';

// エラーIDとメッセージの対応（正: ui-forms-dialogs.md のエラーIDカタログと
// ui-timeline-grid.md 7章の E-RANGE-INVERTED 文言）
export const RANGE_ERROR_MESSAGES: Record<RangeErrorCode, string> = {
  'E-YEAR-FORMAT': '年の形式が正しくありません（例: 1600、前100、-100）',
  'E-YEAR-ZERO': '0年は存在しません（前1年の翌年は西暦1年です）',
  'E-RANGE-INVERTED': '開始年は終了年以前にしてください',
};

export type RangeParseError = { ok: false; code: RangeErrorCode; field: 'start' | 'end' | 'range' };

export type RangeParseResult =
  | { ok: true; start: StoredYear | null; end: StoredYear | null }
  | RangeParseError;

// 〔開始年〕〔終了年〕の生入力を解釈する。空欄 = 自動（null）。エラーは開始 → 終了 →
// 反転の優先順で1件だけ報告する（インライン表示は1メッセージ。エラー時は適用しない）。
// 反転（E-RANGE-INVERTED）は両方が手動指定のときだけ判定する: 自動側の値はデータと共に
// 動くため、片側自動との比較で拒否すると「昨日通った指定が今日は拒否される」ことになる。
// 片側自動で実効範囲が反転した場合は gridColumns 側の防御（1列に留める）が受ける
export function parseRangeInputs(rawStart: string, rawEnd: string): RangeParseResult {
  const start = parseField(rawStart, 'start');
  if (!start.ok) {
    return start;
  }
  const end = parseField(rawEnd, 'end');
  if (!end.ok) {
    return end;
  }
  if (
    start.year !== null &&
    end.year !== null &&
    compareStoredYears(start.year, end.year) > 0
  ) {
    return { ok: false, code: 'E-RANGE-INVERTED', field: 'range' };
  }
  return { ok: true, start: start.year, end: end.year };
}

function parseField(
  raw: string,
  field: 'start' | 'end',
): { ok: true; year: StoredYear | null } | RangeParseError {
  if (raw.trim() === '') {
    return { ok: true, year: null }; // 空欄 = 自動（US-006）
  }
  const parsed = parseYearInput(raw);
  return parsed.ok ? { ok: true, year: parsed.year } : { ok: false, code: parsed.code, field };
}

// 実効範囲 = view.startYear ?? autoRange().start 〜 view.endYear ?? autoRange().end
// （開始・終了は独立に手動指定できる。domain-logic.md 2章）
export function effectiveRange(
  timeline: Timeline,
  currentYear: StoredYear,
): { start: StoredYear; end: StoredYear } {
  const auto = autoRange(timeline, currentYear);
  return {
    start: timeline.view.startYear ?? auto.start,
    end: timeline.view.endYear ?? auto.end,
  };
}

// 空欄時のプレースホルダ「1521（自動）」（screen-01 #range-start の placeholder 書式）
export function rangePlaceholders(
  timeline: Timeline,
  currentYear: StoredYear,
): { start: string; end: string } {
  const auto = autoRange(timeline, currentYear);
  return {
    start: `${formatYear(auto.start)}（自動）`,
    end: `${formatYear(auto.end)}（自動）`,
  };
}

// 入力欄の表示値: 手動指定は formatYear（「前100」形式。表示は常に formatYear = US-005）、
// 自動（null）は空欄
export function rangeInputValues(view: Timeline['view']): { start: string; end: string } {
  return {
    start: view.startYear === null ? '' : formatYear(view.startYear),
    end: view.endYear === null ? '' : formatYear(view.endYear),
  };
}

// 人物0件・イベント0件の年表 = 中央の空状態表示（ui-timeline-grid.md 7章）。
// タグ絞り込みで0行になった状態はデータが空ではないため対象外
export function isTimelineEmpty(timeline: Timeline): boolean {
  return timeline.persons.length === 0 && timeline.events.length === 0;
}

// 「範囲内に該当なし」バナーの判定（US-006 異常系 / domain-logic.md 2章）:
// 全人物で [生年, 没年 or 現在年] と実効範囲の交差なし かつ 範囲内イベント0件。
// 空の年表は空状態表示の管轄（バナーは出さない）。交差判定は astro 軸（0年を挟む
// 紀元前後の比較を連続整数で行う。ADR 0004）
export function hasNoMatchInRange(timeline: Timeline, currentYear: StoredYear): boolean {
  if (isTimelineEmpty(timeline)) {
    return false;
  }
  const range = effectiveRange(timeline, currentYear);
  const startAstro = toAstro(range.start);
  const endAstro = toAstro(range.end);
  const personMatch = timeline.persons.some((person) => {
    const birthAstro = toAstro(person.birth.year);
    const lastAstro = toAstro(person.death === undefined ? currentYear : person.death.year);
    return birthAstro <= endAstro && lastAstro >= startAstro;
  });
  if (personMatch) {
    return false;
  }
  return !timeline.events.some((event) => {
    const yearAstro = toAstro(event.year);
    return startAstro <= yearAstro && yearAstro <= endAstro;
  });
}

// バナー文言（screen-01 #banner-range のとおり。範囲は実効範囲を formatYear で表記）
export function noMatchBannerText(timeline: Timeline, currentYear: StoredYear): string {
  const range = effectiveRange(timeline, currentYear);
  return `指定した範囲（${formatYear(range.start)}〜${formatYear(range.end)}）に該当する人物・イベントはありません。範囲を変更してください。`;
}
