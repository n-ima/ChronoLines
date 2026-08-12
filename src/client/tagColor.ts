// タグ配色の割り当て（design-tokens.md「タグ配色」）: タグ名の文字列ハッシュ
// （コードポイント値の和）mod 8。マスタ管理なしで「同名タグ = アプリ全体で常に同色」が
// 成立する。別名タグが同色になる衝突は許容（識別の主チャネルはラベル文字列。色は補助）。
// 実色は tokens.css の --tag-N-* トークンが正（色リテラルをコンポーネントに書かない規約）。

export const TAG_COLOR_COUNT = 8;

export function tagColorIndex(name: string): number {
  let sum = 0;
  for (const ch of name) {
    sum += ch.codePointAt(0) ?? 0;
  }
  return sum % TAG_COLOR_COUNT;
}

// 人物列のタグ色ドット等で使う CSS 値（tokens.css の --tag-N-dot への参照）
export function tagDotColor(name: string): string {
  return `var(--tag-${tagColorIndex(name)}-dot)`;
}
