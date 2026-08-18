// タグピッカー（人物・イベントフォーム共通部品）の純粋ロジック（ui-forms-dialogs.md 1章）。
// コンポーネントから分離して単体テスト可能にする。
// 上限（タグ名30文字・50個）は schema.ts の tagsSchema と同値に保つ（保存時の
// E-VALIDATION を入力段階で起こさないための入口ガード）。

export const TAG_MAX_LENGTH = 30;
export const TAGS_MAX_COUNT = 50;

// 「登録済みタグから選択」の候補 = 登録済み（allTags）のうち未付与のもの（出現順を保つ）
export function availableTags(registered: string[], assigned: string[]): string[] {
  return registered.filter((tag) => !assigned.includes(tag));
}

// 新規入力中の部分一致サジェスト（空入力 = 全候補）。既存を選べば新規作成しない、の
// 「既存」候補の絞り込みに使う。照合は入力の trim のみ（タグ名は保存値そのままの完全一致の世界）
export function tagSuggestions(registered: string[], assigned: string[], query: string): string[] {
  const q = query.trim();
  const avail = availableTags(registered, assigned);
  return q === '' ? avail : avail.filter((tag) => tag.includes(q));
}

// 付与（Enter・候補クリック共通）。前後空白は trim、同名の重複付与は無視（ui-forms-dialogs.md）。
// 無効な入力（空・30文字超・50個到達）は現在の配列をそのまま返す（参照同一 = 変化なしの印）
export function addTag(assigned: string[], input: string): string[] {
  const tag = input.trim();
  if (tag === '' || tag.length > TAG_MAX_LENGTH) {
    return assigned;
  }
  if (assigned.includes(tag) || assigned.length >= TAGS_MAX_COUNT) {
    return assigned;
  }
  return [...assigned, tag];
}

// 付与済みピルの ✕ による除去
export function removeTag(assigned: string[], tag: string): string[] {
  return assigned.filter((t) => t !== tag);
}

// フォーム送信時の防御的正規化（trim・空除去・重複除去）。通常は addTag が同じ規則で
// 保証するため変化しない（人物・イベントフォーム共通。TASK-105/106）
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag !== '' && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}
