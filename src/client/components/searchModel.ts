// 人物検索の状態モデル（TASK-109 / ui-timeline-grid.md 6章 / US-008）。
// デバウンス確定後のクエリ・ヒット集合（表示行順の person id）・巡回カーソルを純粋に扱う。
// 検索は行を減らさず該当行を指すだけ（絞り込みではない。domain/query.ts searchPersons と同じ規則）。
// React への配線（150ms デバウンス・scrollToIndex の発火）は Toolbar / AppShell が担う。
import { searchPersons } from '../../domain/query';
import type { Person } from '../../domain/schema';

// 検索ボックスの入力デバウンス（ui-timeline-grid.md 6章で 150ms 固定）
export const SEARCH_DEBOUNCE_MS = 150;

export type SearchState = {
  // デバウンス確定後のクエリ（入力中の生値は Toolbar のローカル状態）
  query: string;
  // 表示行順のヒット person id（searchPersons の結果）
  hits: string[];
  // 0始まりの巡回位置（hits が空のときは 0 のまま未使用）
  cursor: number;
};

export const emptySearchState: SearchState = { query: '', hits: [], cursor: 0 };

// クエリ確定（デバウンス後）: ヒット集合を計算しカーソルは先頭へ。
// rowIds はグリッドの表示行順（sortedPersonIds の結果）を渡す
export function applyQuery(rowIds: string[], persons: Person[], query: string): SearchState {
  return { query, hits: searchPersons(rowIds, persons, query), cursor: 0 };
}

// データ・並び順の変化後の再計算: 現在指している人物がまだヒットするならカーソルを追従させ、
// 消えていたら先頭へ戻す（クエリは変えない）
export function refreshHits(state: SearchState, rowIds: string[], persons: Person[]): SearchState {
  const hits = searchPersons(rowIds, persons, state.query);
  const currentId = state.hits[state.cursor];
  const kept = currentId === undefined ? -1 : hits.indexOf(currentId);
  return { query: state.query, hits, cursor: kept >= 0 ? kept : 0 };
}

// 〔前へ/次へ〕（+1/-1）: 端で巡回する（末尾の次は先頭・先頭の前は末尾)。0件時は変化しない
export function stepCursor(state: SearchState, direction: 1 | -1): SearchState {
  const count = state.hits.length;
  if (count === 0) {
    return state;
  }
  return { ...state, cursor: (state.cursor + direction + count) % count };
}

// 現在のヒット（スクロール先の person id）。未検索・0件は null = スクロールしない
export function currentHit(state: SearchState): string | null {
  return state.hits[state.cursor] ?? null;
}

// 「k/n件」ラベル（k = カーソル位置の1始まり）。ヒットが無いときは null
//（0件の表示は「該当なし」が担う。screen-01 .search-hits / .search-none）
export function hitCountLabel(state: SearchState): string | null {
  if (state.hits.length === 0) {
    return null;
  }
  return `${state.cursor + 1}/${state.hits.length}件`;
}

// 「該当なし」を出すか = クエリがあるのにヒット0件。
// 空白のみのクエリは searchPersons が空クエリ扱い（ヒットなし）にするため「未検索」と同じ扱い
export function isNoHit(state: SearchState): boolean {
  return state.query.trim() !== '' && state.hits.length === 0;
}
