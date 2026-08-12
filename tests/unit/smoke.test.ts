import { describe, expect, it } from 'vitest';

// TASK-001 のプレースホルダテスト。テストランナー（Vitest）が動作することだけを確認する。
// ドメインロジックの実テストは TASK-002 以降で domain-logic.md の検算表に対応づけて書く。
describe('プロジェクト雛形（TASK-001）', () => {
  it('Vitest が実行できる', () => {
    expect(1 + 1).toBe(2);
  });
});
