---
agent: orchestrator
description: '各フェーズの進捗とゲート承認状況をダッシュボード表示し、progress.md を更新する'
---

1. `docs/00-overview/progress.md`（なければ `progress_template.md` から作成）と、
   `docs/01-requirements/` 〜 `docs/05-release/` の各成果物の有無・内容を確認する。
2. 各フェーズを「未着手 / 進行中 / ゲート承認待ち / 完了」で判定し、表にする。
3. `progress.md` の内容が実態とずれていれば、更新案を提示し、ユーザー承認後に反映する。
4. 次に着手すべきプロンプトを1つ提案する。
5. ユーザーが整合チェック・監査を求めた場合は、gate-check スキルの「横断整合監査」を
   実行し、成果物間の食い違いを表で報告する（修正はしない）。
