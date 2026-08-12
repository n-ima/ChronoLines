---
agent: release
description: 'environment.mdと環境固有Skillに基づき、リリースを自動実行する。人手必須の作業だけをユーザーに委ねる'
---

前提: `docs/04-test/test-report.md` が作成済みであること。

1. `docs/01-requirements/environment.md` を読み、デプロイ先・自動化してよい範囲・
   人手が必要な作業を確認する。
2. `.github/skills/deploy-<environment>/SKILL.md` があればそれに従う。無ければ
   `.github/skills/skill-authoring/SKILL.md` の手順で新規に作成しながら進める。
3. `docs/05-release/release_checklist_template.md` から `release-checklist.md` を、
   `docs/05-release/changelog_template.md` から（初回のみ）`CHANGELOG.md` を作成する。
4. `environment.md` で「自動」に分類された作業はそのまま自動実行する（確認は求めない）。
5. `environment.md` で「人手」に分類された作業に到達したときだけ、具体的な操作内容を
   提示してユーザーに実行してもらい、完了後に自動で続きを進める。
6. `git push`/タグ付け/force系操作は `.github/hooks/` により機械的に確認が入る。
7. リリース完了後、`docs/00-overview/progress.md` を全フェーズ完了に更新してよいか確認する。
