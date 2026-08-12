# Claude Code 用エントリポイント

このハーネスの共通指示の正は AGENTS.md（下でインポート）。ここには内容を書かない
（Claude Code は AGENTS.md を直接読まないため、このファイルが橋渡しをする）。

@AGENTS.md

## Claude Code 固有の対応表

- フェーズの起動: `.claude/commands/` のスラッシュコマンド（`/03-design-architecture` 等）を
  使う。各コマンドは `.github/agents/*.agent.md` の役割定義と `.github/prompts/` の
  起動指示を読み込む薄いアダプタで、Copilot 側と同じ振る舞いになる。
- サブエージェント: AGENTS.md の `runSubagent` は Claude Code では **Task ツール**で
  `.claude/agents/` の同名サブエージェント（reviewer / task-worker / spec-critic）を
  呼ぶことに読み替える。
- スキル: `.claude/skills/` の各スキルは `.github/skills/` の正へのポインタ。
  新しいスキルを作るときは正（`.github/skills/`）とポインタの両方を作る
  （`skill-authoring` スキル参照）。
- ハンドオフボタンは Claude Code には無い。フェーズ移行は案内どおり
  「新しいセッションで該当スラッシュコマンドを実行」する。
- フックは `.claude/settings.json` に定義済み（Copilot 側と同じスクリプトを共用。
  Windows では Git Bash が必要）。加えて `permissions.deny` でハーネス設定ファイル
  （agents/hooks/workflows/prompts/commands/AGENTS.md等）とテンプレートへの
  Edit/Write/NotebookEdit をツールレベルでハードブロックし、`permissions.ask` は
  Bash と PowerShell の両ツールに定義している（フックと二重の機械的ガード。D046）。
  **ハーネス本体リポジトリを保守する場合**（このテンプレート自体の改修）は、
  人間が自分のターミナルで `python tools/harness-maintenance.py --on --apply` を実行して
  denyとフックの両層をまとめて一時解除し、作業後に `--off --apply` で必ず戻す
  （deny行を手で外すだけではフック層が残り編集できない）。
- プレーンチャットの受付: 依頼を受けたら AGENTS.md の受付ルーチン
  （`request-routing` スキル）に従い、入口のスラッシュコマンドを **Skill ツールで
  自分で起動**する（ユーザーにコマンドを打たせない）。`.claude/commands/` の
  ファイル名がそのままスキル名（例: `12-change-request`）。
- リリースのタグ付け: Claude Code（autoモード）では `git tag` のローカル作成が
  権限ガード（classifier）に拒否される一方、`git push origin main` は許可される
  非対称な挙動がある。エージェントはタグ付けの実行を試みず、annotated タグの
  コマンド（`git tag -a vX.Y.Z -m "..."` と `git push origin vX.Y.Z`）を提示して
  ユーザーに実行してもらう（この運用で複数リリースの安定実績あり）。
- 大規模作業（タスク数十超の実装、コードベース全体の監査・移行）では、Max/Teamプラン
  環境なら **dynamic workflows**（多数サブエージェントの並列実行）の利用を、速度向上の
  理由と**トークンコスト増**を添えてユーザーに提案してよい（承認なしに使わない）。
  結果の記録先（tasks.md・docs/へのレポート保存）は通常フローと同じにし、
  「docs/が正」の原則を崩さない。詳細は `large-scale-development` スキル参照。
