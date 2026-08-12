# docs/ について

このフォルダは、このプロジェクトの「要件定義 → 設計 → 実装 → テスト → リリース」の
成果物を段階的に保存する場所です。フェーズごとにサブフォルダが分かれています。

| フォルダ | フェーズ | 主な成果物 |
|---|---|---|
| `01-requirements/` | 要件定義 | requirements.md, glossary.md, nfr.md |
| `02-design/` | 設計 | architecture.md, adr/, detailed-design/ |
| `03-implementation/` | 実装 | tasks.md |
| `04-test/` | テスト | test-plan.md, test-report.md |
| `05-release/` | リリース | release-checklist.md, CHANGELOG.md |
| `06-retrospective/` | 振り返り | retrospective.md（ハーネス改善提案を含む） |

各フォルダの `*_template.md` はひな形です。実際の成果物は同じフォルダに
テンプレートをコピーして（例: `requirements_template.md` → `requirements.md`）作成します。

進捗状況は [progress.md](progress.md)（`progress_template.md` から作成）で管理します。
`/99-status` プロンプトを実行すると自動で確認・更新できます。

このフォルダにはもう1つ、`learnings.md`（`learnings_template.md` から作成）が置かれます。
開発中に得た教訓を1行ずつ蓄積するファイルで、SessionStartフックにより
以後のすべてのセッションへ自動注入されます。

使い方の全体像は [リポジトリルートのREADME](../../README.md) を参照してください。
