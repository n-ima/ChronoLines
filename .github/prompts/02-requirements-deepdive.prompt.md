---
agent: requirements
description: 'ユーザーの回答をもとに要件定義書・非機能要件・用語集を作成し、ゲート承認を求める'
---

`/01-requirements-intake` で出た質問への回答（このセッションの会話履歴、または
ユーザーが新たに提示した情報）をもとに、以下を行ってください。

1. `docs/01-requirements/requirements_template.md` を `docs/01-requirements/requirements.md`
   にコピーして（未作成の場合）、次を埋める。
   - 目的・背景
   - スコープ / スコープ外
   - ユーザーストーリー一覧（「〜として、〜したい。なぜなら〜」形式）
   - 各ストーリーの受け入れ条件（Given/When/Then）
   - 優先度（MoSCoW）
2. `docs/01-requirements/nfr.md` を `nfr_template.md` から作成し、非機能要件
   （性能・可用性・セキュリティ・運用・コスト・スケール等）を埋める。
3. `docs/01-requirements/glossary.md` を `glossary_template.md` から作成し、
   ドメイン用語を定義する。
4. `docs/01-requirements/environment_template.md` を `environment.md` として作成し、
   デプロイ先・CI/CD・認証情報の保管場所・自動化してよい範囲/人手が必要な範囲を埋める。
   ここは後続フェーズ（特にリリースの自動実行）が依存する最重要項目なので、仮置きにせず
   具体的な回答を得る。曖昧なままにしない。
5. まだ回答が得られていない・前提を仮置きした項目は「未確定事項」として明示する
   （ただしenvironment.mdの内容だけは仮置きのまま完了にしない）。
6. 最後に必ず次の文言で確認する:
   「この内容で要件定義完了としてよいですか？（未確定事項があれば教えてください）」
7. ユーザーが承認したら、`docs/00-overview/progress.md` の要件定義フェーズを完了に更新してよいか確認する。
