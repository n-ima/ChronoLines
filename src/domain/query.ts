// 行の導出（並び替え・絞り込み・検索）と表示範囲の決定（domain-logic.md 2章）。
// グリッドは「表示行 = person id の配列」を受け取るだけにする（ADR 0003）。
// 導出パイプライン: persons → sort → tagFilter → 表示行。検索は行を減らさず該当行を指す。
// 純粋関数のみ（現在年は引数で受け取る。Date・DOM・Node API を参照しない）。
// 結果のメモ化（データ・条件が変わったときのみ再計算）は呼び出し側（Zustand セレクタ）の責務。

import type { Person, Timeline, TimelineEvent } from './schema';
import { decadeStart, fromAstro, toAstro, type AstroYear, type StoredYear } from './year';

// 月日は参考情報（A-005: 年齢計算に使わない）だが、同年生まれ・同年イベントの表示順の
// 安定化にのみ使う。無指定は月13/日32扱いで実在の月日より末尾に置く（domain-logic.md 2章）
const MONTH_UNSPECIFIED = 13;
const DAY_UNSPECIFIED = 32;

// 名前・id の比較はロケール非依存のコードユニット順で決定的にする
// （localeCompare は実行環境の ICU 差で順序が変わりうるため使わない）
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Person.birth と TimelineEvent（year/month/day がトップレベル）の両方を構造的に受ける
type DateParts = { year: StoredYear; month?: number; day?: number };

function compareDateParts(a: DateParts, b: DateParts): number {
  const yearDiff = toAstro(a.year) - toAstro(b.year);
  if (yearDiff !== 0) {
    return yearDiff;
  }
  const monthDiff = (a.month ?? MONTH_UNSPECIFIED) - (b.month ?? MONTH_UNSPECIFIED);
  if (monthDiff !== 0) {
    return monthDiff;
  }
  return (a.day ?? DAY_UNSPECIFIED) - (b.day ?? DAY_UNSPECIFIED);
}

export function sortedPersonIds(timeline: Timeline): string[] {
  if (timeline.sortMode === 'manual') {
    // personOrder の順。存在しない id は無視（防御。正規には E-STORE-ORDER-MISMATCH で
    // 弾かれる）、personOrder に無い人物は末尾（persons への追加順）
    const personIds = new Set(timeline.persons.map((p) => p.id));
    const inOrder = new Set(timeline.personOrder);
    const ordered = timeline.personOrder.filter((id) => personIds.has(id));
    const rest = timeline.persons.filter((p) => !inOrder.has(p.id)).map((p) => p.id);
    return [...ordered, ...rest];
  }
  // birthAsc: (toAstro(birth.year), 生月, 生日, name, id) の昇順。
  // id を最終タイブレークに含めるため全順序 = 入力順に依存しない安定な結果になる
  return timeline.persons
    .slice()
    .sort(
      (a, b) =>
        compareDateParts(a.birth, b.birth) ||
        compareStrings(a.name, b.name) ||
        compareStrings(a.id, b.id),
    )
    .map((p) => p.id);
}

// OR条件（選択タグのいずれかを持つものを残す）
function hasAnyTag(tags: string[], selectedTags: string[]): boolean {
  return selectedTags.some((tag) => tags.includes(tag));
}

export function filterByTags(ids: string[], persons: Person[], selectedTags: string[]): string[] {
  if (selectedTags.length === 0) {
    return ids.slice(); // 選択0個 = 全件
  }
  const byId = new Map(persons.map((p) => [p.id, p]));
  return ids.filter((id) => {
    const person = byId.get(id);
    return person !== undefined && hasAnyTag(person.tags, selectedTags);
  });
}

export function filterEventsByTags(
  events: TimelineEvent[],
  selectedTags: string[],
): TimelineEvent[] {
  if (selectedTags.length === 0) {
    return events.slice(); // 選択0個 = 全件
  }
  // 絞り込み中はタグを持たないイベントも非表示（人物と対称の規則。US-008 の 2026-08-12 差分）
  return events.filter((event) => hasAnyTag(event.tags, selectedTags));
}

// 人物・イベントの tags の和集合（出現順 = persons 配列順 → events 配列順、各 tags 内は定義順）。
// タグ選択UI・フォームの「登録済みタグ」候補の源
export function allTags(timeline: Timeline): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const holder of [...timeline.persons, ...timeline.events]) {
    for (const tag of holder.tags) {
      if (!seen.has(tag)) {
        seen.add(tag);
        result.push(tag);
      }
    }
  }
  return result;
}

// 検索の正規化: NFKC（全角英数・半角カナ等の統一）+ toLowerCase + trim。両辺に同じ正規化を適用する
function normalizeForSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim();
}

// 名前の部分一致で該当する id を表示行順（ids の順）で返す。行は減らさず該当行を指す用途
export function searchPersons(ids: string[], persons: Person[], query: string): string[] {
  const normalizedQuery = normalizeForSearch(query);
  if (normalizedQuery === '') {
    return []; // 空クエリ = ヒットなし扱い（検索UIを閉じた状態）
  }
  const byId = new Map(persons.map((p) => [p.id, p]));
  return ids.filter((id) => {
    const person = byId.get(id);
    return person !== undefined && normalizeForSearch(person.name).includes(normalizedQuery);
  });
}

// 表示範囲の自動決定（US-006）。
// start = min(全人物の生年, 全イベントの年)、end = max(全人物の没年, 全イベントの年, 現在年)。
// 範囲の算術は astro 軸で行う（stored のまま引き算すると存在しない0年を生む。例: 現在年99 − 99）
export function autoRange(
  timeline: Timeline,
  currentYear: StoredYear,
): { start: StoredYear; end: StoredYear } {
  const currentAstro = toAstro(currentYear);
  if (timeline.persons.length === 0 && timeline.events.length === 0) {
    // 0件時: 現在年−99 〜 現在年（100年幅。空状態表示と併用）
    return { start: fromAstro((currentAstro - 99) as AstroYear), end: currentYear };
  }
  let startAstro = Number.POSITIVE_INFINITY;
  let endAstro: number = currentAstro;
  for (const person of timeline.persons) {
    startAstro = Math.min(startAstro, toAstro(person.birth.year));
    if (person.death !== undefined) {
      endAstro = Math.max(endAstro, toAstro(person.death.year));
    }
  }
  for (const event of timeline.events) {
    const eventAstro = toAstro(event.year);
    startAstro = Math.min(startAstro, eventAstro);
    endAstro = Math.max(endAstro, eventAstro);
  }
  // 生年・イベント年がすべて現在年より未来でも反転しない防御クランプ
  endAstro = Math.max(endAstro, startAstro);
  return { start: fromAstro(startAstro as AstroYear), end: fromAstro(endAstro as AstroYear) };
}

// イベントの列集計（US-003、ADR 0003）。
// key: zoom='year' → toAstro(event.year)、zoom='decade' → decadeStart(toAstro(event.year))。
// 各配列は (year, month(無指定は末尾), day(同), name) 昇順
export function eventsByColumn(
  events: TimelineEvent[],
  zoom: 'year' | 'decade',
): Map<number, TimelineEvent[]> {
  const columns = new Map<number, TimelineEvent[]>();
  for (const event of events) {
    const yearAstro = toAstro(event.year);
    const key = zoom === 'year' ? yearAstro : decadeStart(yearAstro);
    const bucket = columns.get(key);
    if (bucket === undefined) {
      columns.set(key, [event]);
    } else {
      bucket.push(event);
    }
  }
  for (const bucket of columns.values()) {
    bucket.sort((a, b) => compareDateParts(a, b) || compareStrings(a.name, b.name));
  }
  return columns;
}
