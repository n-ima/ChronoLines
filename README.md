# copilot-sdlc-harness — AI開発ハーネス（Copilot / Claude Code / Antigravity対応）

「要件定義 → 設計 → 実装 → テスト → リリース」を一気通貫でオーケストレーションするための
**汎用テンプレート** です。特定のアプリのコードは含みません。新しいアプリを作るたびに、
このリポジトリをテンプレートとして使い、要件メモを書くところから始めます。

> **このREADMEはハーネス（テンプレート）自体の説明です。** テンプレートから作られた
> プロジェクトでは、`/00-start-project` 実行時にルートREADMEがアプリ用スタブに
> 置き換えられ、リリース時に正式なアプリのREADMEになります（リポジトリを開いたとき
> 最初にアプリの説明が見えるようにするため）。ハーネスの使い方文書は
> [.github/harness/](.github/harness/) に置かれ、プロジェクトでも残ります。

## 対応プラットフォーム

振る舞いの正は1か所（`AGENTS.md` + `.github/`）に置き、各環境には薄いアダプタだけを
置いているため、**どの環境で使っても同じフェーズゲート・同じ振る舞い**になります。

| 機能 | GitHub Copilot (VS Code) | Claude Code | Antigravity |
|---|---|---|---|
| 共通指示 | AGENTS.md（直接） | CLAUDE.md → AGENTS.md | AGENTS.md（直接） |
| フェーズ起動 | `/03-design-architecture` 等（prompts） | 同名コマンド（`.claude/commands/`） | 同名ワークフロー（`.agents/workflows/`） |
| サブエージェント | runSubagent | Task ツール（`.claude/agents/`） | Agent Managerの別会話 |
| スキル | `.github/skills/` | `.claude/skills/`（正へのポインタ） | 正のファイルを直接参照 |
| フック（機械的ガード） | ✓ `.github/hooks/` | ✓✓ hooks（同一スクリプト共用）+ `permissions.deny` | ✗ IDEのDeny List（GUI）で代替 |
| ハンドオフボタン | ✓ | ✗（コマンド案内に統一） | ✗（コマンド案内に統一） |

どの環境でも入口は同じです: **`/00-start-project` を実行**（Copilotはプロンプト、
Claude Codeはスラッシュコマンド、Antigravityはワークフローとして同名で存在します）。

**対応度の目安**: Copilot＝フル（主環境・ハンドオフ含む） ／ Claude Code＝フル同等
（機械的ガードはむしろ最強: hooks+permissions.denyの二重） ／ Antigravity＝フェーズゲート・
独立レビューはフル、機械的ガードのみGUIのDeny List（Settings → Permissions → Advanced）への
手動登録で代替（AntigravityのIDEはプロジェクト内スクリプトフックを読まないため。実機検証済みの知見）。

> 2026年8月時点のGitHub Copilot / VS Code / Claude Codeの最新仕様（Custom Agents,
> Agent Skills, Agent Hooks, Agent Plugins, AGENTS.md）に基づいて構築しています
> （最終検証日: 2026-08-12）。特に **Agent Hooks と Agent Plugins はPreview機能** であり、
> 仕様が変わる可能性があります。

> 🎨 **はじめての方へ**: [.github/harness/overview.html](.github/harness/overview.html) を
> ブラウザで開くと、このハーネスの全体像・特徴・仕組みが図解つきで分かります
> （ダブルクリックで開ける自己完結型HTML）。ページ上部のナビから
> **エージェント一覧・スキル一覧・コマンド一覧・ガードレール解説**の各ページにも移動できます。
> 実際に手を動かした時に何が起きるかを具体例で追った使い方ガイドは
> **[.github/harness/USAGE.md](.github/harness/USAGE.md)** を参照してください。
> このREADMEは全体構造の説明です。
> ハーネス自体の設計判断の背景・根拠は **[DECISIONS.md](DECISIONS.md)** に記録しています。
> ハーネスを改修する際は、同じ議論を繰り返したり直したバグを再導入したりしないよう、
> 変更前に必ず目を通してください。

## 前提

- VS Code + GitHub Copilot Chat 拡張機能（Custom Agents / Agent Skills 対応バージョン）
- 既定の場所（`.github/agents`, `.github/prompts`, `.github/instructions`, `.github/skills`,
  `.github/hooks`）はVS Codeが自動検出するため、追加設定は基本的に不要です
  （`.vscode/settings.json` は共有ロケーションを追加したい場合の例）。

## 適用範囲（使うべき場面・使うべきでない場面）

- **使う**: 本番運用・長期保守するアプリ、複数人での開発、監査・トレーサビリティ要件のある開発。
- **大規模（US30超・複数サブシステム・複数チーム）も対応**: 単一パイプラインのままではなく、
  システム層＋サブシステム層の2層に分割して使う
  （[large-scale-development](.github/skills/large-scale-development/SKILL.md) スキル。
  サブシステム分割とインターフェース契約は人が承認、サブシステムの内側はAIに任せる）。
- **既存コードベース（brownfield）も対応**: `/11-brownfield-intake` で実装済みコードから
  as-is要件・アーキテクチャを逆起こしし、整合検証を経て差分駆動の改修サイクルに接続する
  （[brownfield-intake](.github/skills/brownfield-intake/SKILL.md) スキル）。
- **使わない**: 使い捨てスクリプト、実験、PoC（素のCopilotに直接頼む方が速い）。

このハーネスはフェーズゲート・独立レビュー・文書化を強制する分、小さな作業には過剰です。
**過剰さへの一番の防御は、対象外の作業に使わせないこと。**

## クイックスタート

1. `requirements/memo.md` に、作りたいアプリについて自由に書く（雑なメモでよい）。
2. Copilot Chat の入力欄で `/00-start-project` を実行する
   （このプロンプトは `agent: orchestrator` にバインドされているため、現在どのエージェントを
   選択していても自動的に `orchestrator` として動く。手動でエージェントを切り替える必要はない）。
   → 進捗を確認し、次にやるべきことを提案してくれる。
3. 各フェーズ専属のエージェント（`requirements` → `design` → `implement` → `test` →
   `release`）に、応答末尾に出る **ハンドオフボタン** で引き継ぎながら進める
   （手動でエージェントを切り替えて `/01-requirements-intake` のようなプロンプトを直接
   実行してもよい。同様に対応するエージェントへ自動的にバインドされる）。

具体的なやり取りの例は [.github/harness/USAGE.md](.github/harness/USAGE.md) を参照してください。

### フェーズごとに人の関わり方が違う（重要）

| フェーズ | 人の役割 |
|---|---|
| 要件定義 | **厚く回答する**。特にデプロイ環境・自動化してよい範囲（`environment.md`）は仮置きせず具体的に答える。ここが要。 |
| 設計 | 質問に答える＋**最終承認1回**。アーキテクチャ・詳細設計はエージェントが決める。 |
| 実装〜テスト | **基本ノータッチ**。ノンストップで自動実行される。真のブロッカー発生時のみ質問が来る。 |
| リリース | **人手必須の作業のみ**対応（支払い、外部ダッシュボードでの承認、ドメイン購入等）。それ以外は`environment.md`に基づき自動実行。push/tag等はHooksで確認が入る。 |

要件定義フェーズだけは厚く聞かれる前提で臨んでください。ここで曖昧に答えると、
「自動のはずの実装〜テスト」や「自動のはずのリリース」で必ず詰まります。

## 3層構造：Agents / Skills / Hooks

このハーネスは3つの異なる仕組みを役割分担させています。

| 仕組み | 役割 | 置き場所 |
|---|---|---|
| **Custom Agents** | フェーズごとの人格・ツール権限・引き継ぎ先を定義する「誰が」 | `.github/agents/*.agent.md` |
| **Subagents** | メインの会話を汚さず独立コンテキストで動く補助（例: `reviewer`） | `.github/agents/*.agent.md`（`user-invocable`/`agents`で制御） |
| **Agent Skills** | フェーズ内で使う手順・チェックリストという「どうやるか」の部品 | `.github/skills/*/SKILL.md` |
| **Prompt Files** | フェーズを1手ずつ進める再利用可能なスラッシュコマンド | `.github/prompts/*.prompt.md` |
| **Agent Hooks** | ゲート・セキュリティ運用を機械的に補強する自動実行（Preview） | `.github/hooks/` |

エージェントを薄く保ち、手順の詳細はSkillに逃がすことで、各エージェントファイルが
肥大化しないようにしています。Skillは段階的開示（`name`/`description`だけを常時読み込み、
本文は関連する時だけ読み込む）により、無関係なSkillがコンテキスト・トークンを圧迫しないように
設計されています（詳細は [AGENTS.md](AGENTS.md) の「コスト」節）。

## フェーズとエージェント／プロンプト対応表

| # | フェーズ | プロンプト | 対応エージェント | 成果物 |
|---|---|---|---|---|
| - | 進捗確認 | `/00-start-project`, `/99-status` | orchestrator | `docs/00-overview/progress.md` |
| 1 | 要件定義（初期） | `/01-requirements-intake` | requirements | 質問リスト |
| 2 | 要件定義（詳細化） | `/02-requirements-deepdive` | requirements（→ `spec-critic`を承認前に1回） | `docs/01-requirements/*.md` |
| 3 | 設計（アーキテクチャ） | `/03-design-architecture` | design | `docs/02-design/architecture.md`, `adr/` |
| 4 | 設計（詳細） | `/04-design-detailed` | design（→ `spec-critic`を承認前に1回） | `docs/02-design/detailed-design/` |
| 5 | 実装計画 | `/05-implementation-plan` | implement | `docs/03-implementation/tasks.md` |
| 6 | 実装 | `/06-implement-task` | implement（→ `task-worker`をタスクごとにsubagent呼び出し） | ソースコード + テスト |
| 7 | テスト計画 | `/07-test-plan` | test | `docs/04-test/test-plan.md` |
| 8 | テスト実行 | `/08-test-execute` | test（→ `reviewer`をsubagent呼び出し） | `docs/04-test/test-report.md` |
| 9 | リリース | `/09-release-checklist` | release | `docs/05-release/release-checklist.md`, `CHANGELOG.md` |
| 10 | 振り返り | `/10-retrospective` | orchestrator | `docs/06-retrospective/retrospective.md` |
| 11 | 既存コードベース導入 | `/11-brownfield-intake` | requirements | as-is逆起こしdocs一式 |
| 12 | **変更請求（運用中の日常）** | `/12-change-request` | change（→ `task-worker` / `reviewer`） | `docs/00-overview/change-requests.md` + 差分更新されたdocs |
| - | 還流適用（**本体リポジトリ専用**） | `/90-apply-retrospective` | harness-maintainer | 改善提案の本体適用 + `DECISIONS.md` 追記 |
| - | 逆同期（本体の改善をプロジェクトへ） | `/91-sync-from-harness` | orchestrator | ハーネスコピーの更新（`tools/sync-harness.py` と併用） |
| - | 使い方ヘルプ | `/98-harness-help` | orchestrator | （次の一手の案内） |

`/01`〜`/09` は**初回構築の一本道**です。リリース後、および既存アプリを `/11` で
取り込んだ後（＝全フェーズが `done` の「運用中」状態）の日常の作業単位は `/12` になります。

### コマンドは覚えなくてよい（受付ルーチン）

**ユーザーは普通のチャットで「◯◯したい」と言うだけでよく、どのコマンドに入るかは
エージェントが決めます。** ハーネス適用済みプロジェクト（`docs/00-overview/progress.md`
がある）では、エージェントは依頼を受けた時点で `request-routing` スキルに従い、

1. `GATE_STATUS` を読んで現在地を確認し、
2. 依頼を分類し、
3. **応答の冒頭で「分類 / 入口 / 影響範囲」を宣言してから**、
4. 該当コマンドを**自分で起動**します（Claude Code では Skill ツール経由）。

これは飾りではなく、ハーネスが成立するための必須条件です。振る舞いの正は
`.agent.md` にあり、それが読まれるのはコマンド実行時だけなので、
**入口に入らなければハーネスは1ミリも動きません**。ユーザーに
「スラッシュコマンドを使いましょうか？」と聞き返すのは誤りで、その時点で
ハーネスは機能していません（`.github/hooks/scripts/route-request.sh` が毎ターン
この契約を注入し、`guard-phase-scope.sh` がフェーズ外の実装を機械的に止めます）。

### 起動経路と等価性

エージェントの起動経路は3つあります: (1) プロンプト実行（`/06-implement-task` 等）、
(2) ハンドオフボタン、(3) `runSubagent`。**どの経路でも同じ動作になるよう、振る舞いの正は
`.agent.md` に置き、プロンプトは薄い起動指示だけにしてあります**（ハンドオフ経由では
`.prompt.md` が読み込まれないため）。経路の違いは会話履歴を引き継ぐか＝コストだけです。

設計フェーズの最終承認（4→5）以降は、フェーズ間の `send: true` ハンドオフにより
実装→テスト→リリースがノンストップでつながる（真のブロッカー・Hooksによる`ask`確認・
`environment.md`で人手指定された作業・`reviewer`が問題を検出した時だけ止まる）。

## レビューは別セッションで（reviewer サブエージェント）

`test` エージェントは全テスト成功後、リリースへ進む前に必ず `runSubagent` で
`.github/agents/reviewer.agent.md` を1回呼び出します。`reviewer` は実装した本人の続きの
会話ではなく **独立したコンテキスト** で起動され、`edit`/`execute` ツールを持たない
読み取り専用エージェントとして、正しさ・セキュリティ（`.github/skills/security-review/SKILL.md`）・
品質をレビューします。これは「実装した本人がそのまま自分のコードを承認してしまう」バイアスを
防ぐための、公式ドキュメントでも推奨されているパターンです。CRITICAL/HIGHの指摘があれば
実装エージェントに自動で差し戻されます。

並列で複数の視点（正しさ用・セキュリティ用・品質用を別々のサブエージェントに分ける等）を
同時に動かす構成も可能ですが、モデル呼び出し回数がその分増えてコストが積み上がるため、
既定では `reviewer` 1回のパスに留めています。

## UIデザインゲート：画面は実装前に「見て」確認する

ブラウザUIを持つアプリでは、設計フェーズで主要画面を**自己完結型HTMLモックアップ**
（`docs/02-design/ui/`、ダブルクリックでブラウザ表示可能）として作成し、
ユーザーが視覚確認してから実装に進みます（`.github/skills/ui-design-mockup/SKILL.md`）。

- 「実装が終わって動かして初めてデザインの問題が分かる」という最も高くつく失敗を、
  設計段階の視覚ゲートで防ぎます。
- **閲覧はブラウザで開くだけなのでトークンコスト・ゼロ**。修正はチャット指示でも
  HTMLの直接編集でも受け付けます。
- コスト配慮: 全画面ではなく主要フロー上の画面＋デザイン基準になる代表画面に絞ります。
  UIの無いアプリ（CLI・APIのみ）ではこのゲート自体をスキップします。
- 承認されたモックアップは画面設計の「正」となり、実装（task-worker）が参照し、
  テスト（Playwrightスクリーンショット）が乖離を検出します。

## 成長ループ：使うたびに賢くなるハーネス

このハーネスは「一度作って終わり」ではなく、**使った経験が次のプロジェクトの入力になる**
仕組みを持っています（詳細は [AGENTS.md](AGENTS.md) の「成長ループ」節と
[.github/skills/harness-retrospective/SKILL.md](.github/skills/harness-retrospective/SKILL.md)）。

1. **教訓ログ（`docs/00-overview/learnings.md`）** — 開発中、エージェントが訂正を受けたり
   同じ失敗を繰り返したりしたら、その場で1行追記される。SessionStartフックが
   このファイルを以後の全セッションに自動注入するため、「言ったのに忘れられる」が起きない。
2. **振り返り（`/10-retrospective`）** — リリース後に実施。摩擦のあった出来事を
   「ハーネス改善 / プロジェクト固有 / 一過性」に分類し、ハーネス改善分は
   対象ファイル・問題・提案・根拠の4点セットの改善提案表にまとめる。
3. **本体への還流** — 改善提案と、開発中に生まれた再利用可能なSkill（`deploy-*`等）を
   このテンプレートリポジトリに適用する（ハーネス設定はエージェントの自動編集が
   禁止されているため、還流は人間が行い、`DECISIONS.md` に根拠つきで記録する）。
   以後の新プロジェクトは改善済みの状態から始まる。

## コンテキストロット対策（1タスク1セッションの実現方法）

長い会話ほどモデルの想起精度が落ちる "context rot" という現象がAnthropicの検証で
報告されています。「1タスク1セッション」という経験則はこれへの合理的な対策です。

このハーネスでは、実装フェーズの `implement` エージェントが全タスクを1つの会話で
連続実装するのではなく、**タスクごとに `task-worker` サブエージェントを呼び出して
1タスクずつ独立したコンテキストで実装させます。** `implement` 自身は「次はどのタスクか」を
判断する軽いコーディネーターに徹し、実装の詳細を自分の会話に溜め込みません。
`docs/03-implementation/tasks.md` が唯一の正の状態なので、何らかの理由で会話が
リセットされても、ファイルを見れば同じ場所から再開できます。

この考え方は他のフェーズにも当てはまります。**1つのフェーズ内でも会話が長くなってきたと
感じたら、無理に続けず新しいチャットセッションを開始して `docs/` の関連ファイルを
読み直させる方が、精度の面でも有利です。** ドキュメントに残っている情報は会話をまたいでも
失われません。

## Agent Hooks によるゲート・セキュリティ強制（Preview）

`.github/hooks/gate-hooks.json` と `.github/hooks/security-hooks.json` により、
以下を機械的に補強しています（詳細は [.github/hooks/README.md](.github/hooks/README.md)）。

- `*_template.md` への直接編集を **deny**
- `git push` / `git tag` / `--force` / `reset --hard` / `rm -rf` を **ask**（毎回確認）
- セッション開始時に現在のフェーズゲート状況を自動的にコンテキスト注入
- **ユーザーの依頼のたびに、現在のゲート状況と受付ルーチンの契約を注入**
  （`route-request`。SessionStart の1回だけだと会話が伸びるほど薄まり、
  ハーネス外の場当たり作業に落ちるため）
- **フェーズ外でのアプリコード編集を ask**（`guard-phase-scope`。どのフェーズも
  `in_progress` でない＝運用中なのに `/12-change-request` を経ずにコードを触ろうと
  したときに止める。「入口に入る」を指示ではなく機械で担保する）
- **記録せずにセッションを終えようとしたら1回だけブロック**（`remind-record`。
  アプリのコードを変更したのに `docs/00-overview/` に何も残っていない状態で
  止まろうとしたとき。成長ループは記録されない限り回らない）
- `.github/agents/` / `.github/hooks/` / `AGENTS.md` / `plugin.json` /
  `.vscode/settings.json`（ハーネス自体の運用ルール）への編集を **deny**
  （プロンプトインジェクション等による自己権限昇格・ガードレール解除の防止。
  `.github/skills/` は動的なSkill追加を許すため対象外）
- クラウド認証情報・秘密鍵らしき高確度パターンを **deny**、汎用的な `api_key=...` 等は **ask**

ハーネス本体を保守するとき（このテンプレート自体の改修）は、`permissions.deny` と
`guard-harness-config-edit` フックの**両方**を外す必要があります。
`python tools/harness-maintenance.py --on --apply` が両方をまとめて退避し、
`--off --apply` で戻します（人間が自分のターミナルで実行するツール。
エージェント経由では確認入力に失敗して実行できません）。

ただしPreview機能のため、組織設定や拡張機能のバージョンによっては発火しないことがあります。
その場合でも `AGENTS.md` の指示レベルのルールが効くようにしてあります（二重の安全網）。
さらに `.github/CODEOWNERS`（テンプレート）とブランチ保護を組み合わせることで、
ハーネス自体への変更に人間のレビューを必須にすることを推奨します。

## 再利用パッケージとしての配布（`plugin.json`）

このハーネス全体は `plugin.json` により Agent Plugin としても定義しています
（`agents` / `skills` / `hooks` / `commands` が `.github/` 配下の同じ実体を指すため、
このリポジトリを直接開いた場合と、他リポジトリにプラグインとしてインストールした場合の
両方で同じ内容が使えます）。ただしAgent PluginsもPreview/実験的機能であり、
組織ポリシーで無効化されている場合があります。

## ディレクトリ構成

```
AGENTS.md                     … 全AIエージェント共通の唯一の指示ファイル（正）
CLAUDE.md                      … Claude Code用エントリポイント（AGENTS.mdをインポート）
DECISIONS.md                   … ハーネス自体の設計判断ログ（改修前に必読）
plugin.json                    … Agent Plugin マニフェスト（配布用、任意）
.claude/                       … Claude Code用アダプタ（commands/agents/skills=正へのポインタ、settings.json=hooks配線）
.agents/                       … Antigravity用アダプタ（workflows=正へのポインタ）
.github/
  agents/                       … フェーズごとのCustom Agent（旧chatmode）+ reviewer(subagent)
  skills/                       … フェーズで使う手順・チェックリスト（Agent Skills）
                                    security-review, skill-authoring 等を含む
  prompts/                      … フェーズを進めるプロンプトファイル
  hooks/                        … ゲート・セキュリティを機械的に補強するフック（Preview）
  workflows/                    … ハーネス自身の整合性CI（validate + フックselftest + eval）
  instructions/                 … パス限定の追加指示（例: docs/** 向け）
  harness/                      … ハーネス自体の使い方文書（USAGE.md・overview.html。
                                    ルートREADMEがアプリ用になってもここに残る）
  CODEOWNERS                    … ハーネス設定への人間レビュー強制のテンプレート
tools/                         … 保守・検証ツール（validate-harness / generate-adapters /
                                    harness-maintenance / sync-harness / intake-app /
                                    effort-report / golden-eval）
requirements/
  memo.md                       … ユーザーが最初に書く生の要件メモ
docs/
  00-overview/                    … 進捗ダッシュボード（GATE_STATUS）・learnings・変更請求台帳
  01-requirements/                … 要件定義書・非機能要件・用語集・environment.md（デプロイ環境/自動化境界）
  02-design/                      … アーキテクチャ設計・ADR・詳細設計
  03-implementation/              … 実装タスクリスト（task-workerサブエージェントが1タスクずつ実装）
  04-test/                        … テスト計画・テスト結果
  05-release/                     … リリースチェックリスト・CHANGELOG
  06-retrospective/               … 振り返り・effort-report（トークン効率）
```

## 設計方針

- **フェーズごとに人の関わり方を変える**: 要件定義は厚いヒアリング、設計はエージェント主導＋
  最終承認、実装〜テストは全自動、リリースはenvironment.mdに基づく自動実行＋人手必須部分のみ人。
  一律に「毎回確認」でも一律に「全部自動」でもなく、フェーズの性質に応じて変える。
- **要件定義がすべての前提**: 特にデプロイ環境・自動化境界（`environment.md`）は
  要件定義フェーズでしか正しく聞き出せない。ここを曖昧にしたまま進めると、
  後工程の自動化が必ず破綻するため、他のどの項目より優先して具体化する。
- **技術スタック非依存**: このハーネス自体は特定の言語・フレームワークに依存しない。
  技術選定は設計フェーズでトレードオフを提示した上でユーザーが決める。
- **エージェントを薄く、手順はSkillへ**: 各エージェントファイルは人格・権限・引き継ぎ先だけを持ち、
  詳細な手順・チェックリストはAgent Skillsに分離する。
- **環境固有Skillは動的に育てる**: `.github/skills/deploy-<environment>/` はハーネスに
  事前収録せず、実際にリリースする環境が判明した時点で `skill-authoring` スキルを使って
  その場で作成する。2回目以降の同じ環境へのリリースはそのSkillにより自動化される。
- **クロスエージェント対応**: `AGENTS.md` を単一の正として、VS Code Copilot以外
  （Copilot cloud agent, Claude Code等）でも同じルールが自然に効くようにする。
- **破壊的操作は都度確認**: push・タグ付け・force系操作・本番デプロイ等は
  `environment.md`の分類に関わらず必ず事前確認する（Hooksによる機械的補強あり）。
- **レビューは別セッション（サブエージェント）で**: 実装した本人がそのまま自己承認しないよう、
  独立コンテキストの `reviewer` サブエージェントが正しさ・セキュリティ・品質を確認してから
  リリースに進む。レビュワーは「合格」をデフォルトにせず反証を試みる懐疑チューニング。
- **レビューの配置は「タスク単位は機械、出口で意味」**: 実装工程の品質はタスク単位の
  機械的検証（done契約・テスト）で守り、意味的な独立レビュー（`reviewer`）は
  実装＋テストの出口（テスト完了後・リリース前）に1回置く。
  「完了は自然言語の主張ではなく決定論的検証に束縛する」「テストで判定できることを
  LLMに判定させない」というAnthropic公式のハーネス設計指針と、クリーンコンテキストの
  独立レビューほど精度が高いという業界の実証に基づく配置（タスクごとのLLMレビューは
  コスト増と過剰ゲートを招くため既定にしない。重要案件では明示要求で追加可能）。
- **完了は宣言ではなく証拠で判定（done契約）**: 各タスクは着手前に完了条件
  （検証コマンド＋実行時確認）を定義し、その証拠をもってのみ完了にする。
  同一タスクの失敗は retry → replan → escalate の3状態で昇格し、3回失敗で
  自動停止して人にエスカレーションする（無限ループでトークンを浪費しない）。
- **ハーネス自身も検査対象**: 構造検証（validate-harness）・フック自己テスト（44ケース）・
  Golden Eval（完了宣言と成果物実態の突き合わせ）を本体CIで実行する。
  「機械的強制を説く本体が自分は手動検査」という矛盾を持たない。
- **足すだけでなく引く（de-scaffolding）**: 振り返りでは「足りないガード」と同じ真剣さで
  「モデルの向上で不要になったガード」を問い、陳腐化した足場は削除する。
- **セキュリティは指示だけでなくHooksでも担保**: 最小権限のツール割り当て、
  ハーネス自体の設定への自動編集禁止、シークレットのハードコード検知をHooksで機械的に強制する。
- **トークンコストを意識したモデル選択**: 高頻度・機械的なフェーズは`model: auto`、
  一度の判断ミスが手戻りに直結するフェーズ（設計・レビュー）は強いモデルの利用を検討する。
  サブエージェントの並列多用や、無関係なSkillの読み込みでコストを浪費しない。

詳細な運用ルールは [AGENTS.md](AGENTS.md) を参照してください（特にセキュリティガードレール・
コスト方針・サブエージェント活用方針の節）。

## 既知の制約・要検証事項

- Custom Agents / Agent Skills / Agent Hooks / Agent Plugins は執筆時点でいずれも
  比較的新しい機能（一部Preview）であり、実際にVS Code上で動かして
  フォーマットのズレがないか確認することを推奨します。
- Hooksのstdin/stdoutペイロード形状は公式一次情報から確認した範囲での実装であり、
  実環境での挙動確認・調整が必要な場合があります（[.github/hooks/README.md](.github/hooks/README.md)参照）。
- VS Code Copilot は現在 `.claude/settings.json` のフック定義もネイティブに解釈するため、
  `.github/hooks/` と**同一スクリプトが二重発火する可能性**があります（実機確認は未了。
  ガードは冪等のため実害は警告・ログの重複に留まります。確認後、二重なら片系を無効化します）。
