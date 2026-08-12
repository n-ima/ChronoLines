---
agent: test
description: '要件・設計からテスト計画（単体/結合/E2E/非機能）を作成する'
---

前提: 実装フェーズ（`docs/03-implementation/tasks.md` の全タスク）が完了していること。
このフェーズは自動実行区間なので、計画作成後に確認は求めず、そのまま `/08-test-execute` に進む。

1. `docs/04-test/test_plan_template.md` を `test-plan.md` にコピーする。
2. `docs/01-requirements/requirements.md` の受け入れ条件（Acceptance Criteria）を1つずつ
   テストケースに落とし込む。正常系・異常系・境界値を含める。
3. テスト種別（単体・結合・E2E・非機能: 性能/セキュリティ/負荷）ごとに整理する。
4. 各テストケースに要件ID・優先度・前提条件・期待結果を記載する（トレーサビリティ確保）。
5. 作成できたら止まらずにテスト実行（`/08-test-execute`）へ進む。
