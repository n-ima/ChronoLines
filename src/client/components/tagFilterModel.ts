// タグ絞り込みの状態モデル（TASK-110 / ui-timeline-grid.md 6章 / US-008）。
// 選択集合（選択順を保持）・候補の件数表示・表示行/イベントレーンへの適用を純粋に扱う。
// OR条件・選択0個=全件の規則の正は domain/query.ts（filterByTags / filterEventsByTags）。
// React への配線（ドロップダウンの開閉・外側クリック）は Toolbar / AppShell が担う。
import { allTags, filterByTags, filterEventsByTags, sortedPersonIds } from '../../domain/query';
import type { Timeline, TimelineEvent } from '../../domain/schema';

// ドロップダウンの1候補: タグ名 + 色ドット用のタグ名そのもの + 件数（人物n・イベントm）
export type TagFilterOption = { tag: string; personCount: number; eventCount: number };

// 候補一覧: allTags の順（人物→イベントの出現順）。件数は絞り込み前の全件に対して数える
// （screen-01 renderTagUi と同じ。絞り込み後の件数にすると選択のたびに数字が動いて基準を失う）
export function tagFilterOptions(timeline: Timeline): TagFilterOption[] {
  return allTags(timeline).map((tag) => ({
    tag,
    personCount: timeline.persons.filter((p) => p.tags.includes(tag)).length,
    eventCount: timeline.events.filter((e) => e.tags.includes(tag)).length,
  }));
}

// チェックボックスのトグル: 未選択なら末尾へ追加（適用中ピルは選択順に並ぶ。screen-01 toggleTag）
export function toggleTag(selected: string[], tag: string): string[] {
  return selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];
}

// 適用中ピルの ✕（個別解除）
export function removeTag(selected: string[], tag: string): string[] {
  return selected.filter((t) => t !== tag);
}

// データ変化への追従: 年表から消えたタグ（人物・イベントの編集/削除で不在になったもの）は
// 選択からも外す。残すとドロップダウンに無いタグの選択が残り、解除手段がピルの✕だけになる
// （searchModel.refreshHits と同じ「データ変化に状態を追従させる」規則）。
// 変化が無ければ同一参照を返す（setState の no-op 判定・再レンダリング抑止のため）
export function retainKnownTags(selected: string[], timeline: Timeline): string[] {
  const known = new Set(allTags(timeline));
  const next = selected.filter((t) => known.has(t));
  return next.length === selected.length ? selected : next;
}

// 〔タグ▼〕ボタンのラベル: 適用中は選択数を添える（screen-01 renderTagUi）
export function tagButtonLabel(selected: string[]): string {
  return selected.length === 0 ? 'タグ ▼' : `タグ（${selected.length}） ▼`;
}

// 表示行 = persons → sort → tagFilter（domain-logic.md 2章のパイプライン）。
// OR条件・選択0個 = 全件。検索（searchPersons）はこの結果の行順に対して行う
export function visibleRowIds(timeline: Timeline, selected: string[]): string[] {
  return filterByTags(sortedPersonIds(timeline), timeline.persons, selected);
}

// イベントレーンへの適用（人物と対称の OR 条件。絞り込み中はタグなしイベントも非表示）
export function visibleEvents(events: TimelineEvent[], selected: string[]): TimelineEvent[] {
  return filterEventsByTags(events, selected);
}
