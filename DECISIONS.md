# DECISIONS.md — このハーネス自体の設計判断ログ

これは `docs/02-design/adr/`（**生成するアプリ**の設計判断）とは別物で、
**このハーネス自体**がなぜ今の形になっているかを記録するものです。
今後ハーネスを改修する人（自分自身を含む）が、同じ議論を繰り返したり、
一度直したバグを再導入したりしないようにするための記録です。

最終更新: 2026-08-02

各項目は「決定」「根拠・出典」「捨てた選択肢」の順で書く（`docs/02-design/adr/adr_template.md` と
同じ形式を踏襲）。

---

## D001: chatmode.md ではなく custom agents(.agent.md) を採用

- **決定**: `.github/chatmodes/*.chatmode.md` ではなく `.github/agents/*.agent.md` を使う。
- **根拠**: VS Code公式ドキュメントで「custom chat modes は custom agents に名称・仕様変更され、
  `.chatmode.md` は非推奨。`.agent.md` にリネームして使う」と明記されている
  ([VS Code Docs: Custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents))。
  最初のバージョンは学習知識だけで `.chatmode.md` を使っており、実際に調べ直して判明した誤り。
- **捨てた選択肢**: `.chatmode.md` のまま運用（非推奨のため不採用）。

## D002: Agent Skills(SKILL.md) の採用

- **決定**: 要件引き出し・ADR作成・テストケース設計・ゲート判定などの手順を
  `.github/skills/*/SKILL.md` として部品化する。
- **根拠**: VS Code / Copilot CLI / Copilot cloud agent 横断の公開標準（agentskills.io）として
  Agent Skills が存在し、`name`/`description` だけを常時読み込み、本文は関連時のみ読み込む
  「段階的開示」でコンテキスト消費を抑える設計になっている
  ([VS Code Docs: Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills))。
  当初はこの仕組みの存在自体を見落としていた。
- **捨てた選択肢**: 手順をすべて各エージェントファイルの本文に書く（肥大化し、他エージェントから
  再利用できない）。

## D003: Agent Hooks による機械的なゲート強制

- **決定**: `.github/hooks/*.json` + シェルスクリプトで、指示だけでは守られない可能性がある
  ルール（テンプレ直接編集の禁止、危険なgit操作の確認、ハーネス設定自体の保護、
  シークレットのハードコード検知）を機械的に強制する。
- **根拠**: 最初のハーネスは「LLMが指示を守ってくれることを祈るだけ」の強制力ゼロの構成だった
  という指摘を受け、VS Code公式のAgent Hooks（Preview機能）を調査して採用
  ([VS Code Docs: Agent hooks](https://code.visualstudio.com/docs/agent-customization/hooks))。
- **注意**: Preview機能であり、stdin/stdoutのペイロード形状は将来変わりうる。
  スクリプトはパース失敗時に安全側（許可）に倒す設計にしている。

## D004: reviewer サブエージェントによる別セッションレビュー

- **決定**: `test` エージェントは全テスト成功後、リリースに進む前に必ず `runSubagent` で
  `reviewer`（読み取り専用・独立コンテキスト）を1回呼び出す。
- **根拠**: 「実装した本人がそのまま自己レビューして自己承認する」バイアスを避けるため、
  独立したコンテキストでのレビューが公式に推奨されている
  ([VS Code Docs: Subagents](https://code.visualstudio.com/docs/agents/subagents) の
  code-reviewサブエージェント例)。ユーザーからの「レビューは別セッションで行った方がよい」
  という指摘とも一致し、それが単なる思い込みではなく公式ベストプラクティスであることを確認した。
- **捨てた選択肢**: 並列の多視点レビュー（正しさ用・セキュリティ用・品質用を別々に並列実行）は
  精度は上がるがモデル呼び出し回数が視点の数だけ増えてコストが積み上がるため、既定では不採用。
  プロジェクトの重要度に応じてユーザーが明示的に要求した場合のみ有効にする。

## D005: security-review Skill は公式のものを取り込む

- **決定**: セキュリティレビューの手順をゼロから書かず、`github/awesome-copilot` の公式
  `security-review` Skillを参考にして `.github/skills/security-review/SKILL.md` を作成した。
- **根拠**: ユーザーからの「公式のSkillがあれば採用する」という方針に基づき、
  8ステップの手順（スコープ確定→依存監査→シークレットスキャン→脆弱性深掘り→
  クロスファイル解析→自己検証→レポート作成→修正案提示、ただし自動適用はしない）を
  このハーネスのドキュメント構成に合わせて適合させた。
- **横展開**: `skill-authoring` Skill内に「ゼロから書く前に公式/コミュニティ製Skillの
  流用を優先する」という手順として一般化した（デプロイ環境Skill・スタック規約Skillにも適用）。

## D006: ハーネス自体の設定ファイルへの自動編集を禁止

- **決定**: `.github/agents/`, `.github/hooks/`, `AGENTS.md`, `plugin.json`,
  `.vscode/settings.json` へのエージェントによる自動編集を `security-hooks.json` でdenyする。
  `.github/skills/` は動的追加を許すため対象外。
- **根拠**: プロンプトインジェクション等による自己権限昇格・ガードレール解除を防ぐという
  セキュリティガードレールの要求に対応。`.github/CODEOWNERS` テンプレートとブランチ保護の
  組み合わせも合わせて推奨。

## D007: 呼び出し頻度が高いエージェントは `model: auto`

- **決定**: `orchestrator` / `implement` / `test` / `task-worker` は `model: auto`。
  `design` / `release` / `reviewer` はモデルを固定せず、必要に応じてユーザーが強いモデルに
  切り替えることを推奨する（本文にその旨を明記）。
- **根拠**: GitHub Copilotは2026年6月からトークン量に応じた従量課金（GitHub AI Credit）に
  移行しており、「利用可能な中で最も安価なモデルを自動選択するAuto」には追加の割引もある。
  一方、設計判断やレビューの誤りは手戻りコストの方が高くつくため、そこだけは強いモデルを
  検討する価値がある、という非対称な扱いにした。

## D008: プロンプトファイルは `agent:` で明示的にバインドする

- **決定**: `.github/prompts/*.prompt.md` の frontmatterから、旧来の `mode: 'agent'` /
  `tools: [...]` を削除し、`agent: <name>` で対応するCustom Agentに明示的にバインドした。
- **根拠**: 実際に使い方ドキュメントを書きながらシナリオを検証した際に、
  「`agent:` を指定しない場合、プロンプトは選択中の別エージェント/既定モードのツール制限の
  ままで実行される」という仕様（[VS Code Docs: Prompt files](
  https://code.visualstudio.com/docs/agent-customization/prompt-files)）を確認し、
  最初のバージョンではこのバインディングが漏れていたことが判明した。
  これは「ユーザーに言われたから直した」のではなく、シナリオ検証で見つけた実装ミス。

## D009: orchestrator に `edit` 権限を付与（progress.md初回作成のため）

- **決定**: `orchestrator` の `tools` に `edit` を追加。ただし「未着手/進行中」への機械的な
  更新はそのまま行ってよいが、「完了(done)」への変更は必ずユーザー承認を要する、という
  区別を本文に明記。
- **根拠**: 実際にシナリオを辿って検証した際、`orchestrator` が読み取り専用のままだと
  初回起動時に `docs/00-overview/progress.md` を作成できない（`gate-check` Skillの
  「無ければ作成する」という指示を実行する権限がない）というバグを発見した。

## D010: reviewer の発見事項を test-report.md / security-review-report.md に転記する

- **決定**: `reviewer` は読み取り専用（`edit`ツールなし）のため、発見事項をファイルに残すのは
  呼び出し元の `test` エージェントの責務であると明記し、`docs/04-test/security_review_report_template.md`
  を新設した。
- **根拠**: シナリオ検証で「独立レビューの結果が記録に残らず消えてしまう」抜けを発見した
  （全自動区間だからといって人が後から確認できなくなってよいわけではない）。

## D011: 実装ループを `task-worker` サブエージェントに分割（コンテキストロット対策）

- **決定**: `implement` エージェントはコードを直接書かず、タスク1つにつき1回
  `runSubagent` で `task-worker`（独立コンテキスト）を呼び出す方式に変更した。
- **根拠**: Anthropicの公式エンジニアリングブログ
  ([Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))
  で報告されている "context rot"（会話が長くなるほど想起精度が落ちる現象）への対策。
  「1タスク1セッション」という経験則は、この現象に対する合理的な対策であることを確認した。
  ユーザーからの疑問がきっかけで調査し、既存の設計（全タスクを1つの会話でノンストップ実装）が
  この観点で弱点であることが判明したため修正した。
- **横展開**: フェーズ間・フェーズ内でも「会話が長くなってきたら新しいセッションを始めて
  `docs/` を読み直す」という原則をAGENTS.md/USAGE.mdに明文化した
  （ドキュメントが記憶であり、会話が記憶ではない、という設計思想の言語化）。

## D012: Hooksスクリプトの実機バグ2件を修正

- **決定/修正内容**:
  1. `guard-secret-leak` の正規表現が、VS CodeのフックペイロードがJSON文字列として
     引用符を `\"` にエスケープすることを考慮しておらず、典型的な `api_key = "..."` の
     漏洩パターンを検知できていなかった。エスケープされた引用符も許容するよう修正。
  2. Windows PowerShell 5.1 は `.ps1` ファイルがBOMなしUTF-8だと日本語文字列を誤読し、
     全PowerShell版フックがパースエラーで起動不能だった。全 `.ps1` をBOM付きUTF-8で
     保存し直して解決。
- **根拠**: 「実機で動かして確認したか」という指摘を受け、実際にbash/PowerShellでhookスクリプトに
  サンプル入力を与えて検証した結果、上記2件が実際に動かないことを確認した
  （机上のレビューだけでは見つからなかった）。
- **教訓**: 日本語（非ASCII）を含むテキストをWindows向けスクリプトに埋め込む場合、
  BOM付きUTF-8での保存を徹底する。JSON経由のペイロードを正規表現で扱う場合、
  エスケープされた引用符を考慮する。

## D013: Playwright（ブラウザ動作確認）をテストフェーズに組み込み

- **決定**: 生成するアプリがブラウザベースのUIを持つ場合、`test` エージェントは
  ユニット/結合テストに加えて、Microsoft公式の Playwright MCP サーバー
  （`@playwright/mcp`）を `.vscode/mcp.json` に追加し、実際にページを表示・操作して
  確認する手順を `test-case-design` Skillに追加した。
- **根拠**: ユーザーからの「ブラウザで確認できるものはPlaywrightも使って表示や動作確認を行う」
  という要求に基づき、Microsoft公式のPlaywright MCPサーバー
  ([microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)) の存在と
  VS Codeでの設定方法を確認した上で採用。
- **設計判断**: ハーネス自体には（このテンプレートにはUIが無いため）`.vscode/mcp.json` を
  事前に用意せず、設計フェーズでUIありと判明した時点でテストエージェントが動的に追加する
  （D005の「動的Skill/設定は判明した時点で作る」という方針と一貫させた）。

## D014: ゲート陳腐化検知フックの追加

- **決定**: 承認済み（GATE_STATUSが `done`）のフェーズに対応するファイル
  （`requirements.md`, `architecture.md`, `tasks.md`, `test-report.md`,
  `release-checklist.md`）が編集された場合、`PostToolUse` フックで
  「承認済みだが編集された。後続フェーズとの整合を確認すること」という
  非ブロッキングの `systemMessage` を出す。
- **根拠**: 「要件や設計を手動で直して続けてよいか」という質問に対し、
  「ファイル編集自体は安全（各エージェントは会話ではなくファイルを読み直す設計のため）だが、
  承認後に変更すると下流フェーズとの整合が自動チェックされないままになる」という
  非対称性があったため、機械的なリマインダーを追加して補強した。

## D015: 要求文にEARS記法を採用

- **決定**: `requirements-elicitation` Skillと要件定義書テンプレートに、EARS
  （Easy Approach to Requirements Syntax）記法・INVEST基準・品質特性シナリオ
  （刺激→環境→応答→応答測定の定量NFR）・前提/リスク台帳を追加した。
- **根拠**: EARSはRolls-Royce発で[Airbus/NASA/Intel/Bosch等が採用](https://alistairmavin.com/ears/)する
  業界標準の要求構文であり、AWSのspec駆動開発IDE「Kiro」も中核に採用している。
  「要件定義の専門性が高度なレベルか」という問いに対し、Given/When/Thenだけでは
  要求文自体の曖昧さ（「適切に」「なるべく」等）を排除する仕組みが無かったため補強した。
- **捨てた選択肢**: ISO/IEC/IEEE 29148の完全準拠テンプレート（重すぎて対話型の
  要件定義の良さを損なう。EARSは軽量で訓練コストが低いことが採用理由）。

## D016: spec-critic サブエージェント（上流の独立レビュー）

- **決定**: `reviewer`（コード）と同じ「別セッションでの独立レビュー」パターンを
  要件定義・設計のゲート承認前にも適用する `spec-critic` サブエージェントを新設した。
  既定のサブエージェント経路は4つ（requirements→spec-critic, design→spec-critic,
  implement→task-worker, test→reviewer）になった。
- **根拠**: 欠陥の修正コストは下流ほど大きい（要件の欠陥が実装後に見つかると
  手戻りが最大になる）ため、独立レビューの費用対効果が最も高いのは上流。
  呼び出しは各ゲート1回に限定し、コスト増を最小にしている。

## D017: 成長ループ（learnings / retrospective / 本体還流）

- **決定**: 「使うたびに賢くなるハーネス」を実現する3層の記録構造を導入した。
  1. `docs/00-overview/learnings.md` — 訂正・失敗の都度1行追記する教訓ログ。
     SessionStartフックが自動注入するため、書けば以後の全セッションに確実に効く。
  2. `docs/06-retrospective/` + `/10-retrospective` — リリース後の構造化された振り返り。
     摩擦を「ハーネス改善/プロジェクト固有/一過性」に分類し、改善提案表を作る。
  3. 本体還流 — 改善提案と再利用可能Skillをハーネス本体リポジトリに人間が適用し、
     DECISIONS.mdに根拠つきで記録する。以後の新プロジェクトは改善済みから始まる。
- **根拠**: learnings.md（教訓ファイル）の蓄積は自己改善エージェントの確立された
  パターン。ポイントは「記録が実際に次の入力になる」機構で、
  単に書くだけでなくSessionStartフックでの自動注入まで実装した（注入されない記録は
  存在しないのと同じ）。ハーネス本体はテンプレートとして各プロジェクトにコピーされるため、
  プロジェクト内の学びを本体に還流する明示的な経路（振り返り→改善提案表→人間による適用）を
  定義した。ハーネス設定はセキュリティ上自動編集禁止（D006）のため、還流の適用は
  意図的に人間の作業としている。

## D018: databricks-job-dev-harness検証からの還流（第1弾・A項目群）

- **出典**: 派生ハーネス databricks-job-dev-harness の構築・E2E検証第1回
  （daily-sales-report-trial）からの改善指示書（CreateAppl-improvement-handover.md）。
  **D017の成長ループが実際に一周した最初の実例**。ユーザーの明示指示のもと適用した。
- **適用した項目と根拠**:
  - **A-1 PreCompact再注入**: コンテキスト圧縮でSessionStart注入分（GATE_STATUS・教訓）が
    失われる穴を塞ぐ。inject-progressをイベント引数化しPreCompactにも登録。実機検証済み。
  - **A-2 教訓トリガー拡張（最重要）**: E2E実測で「試行錯誤の末に確立した実行方法が
    記録されず、別セッションで同じ試行錯誤が再発」した欠陥への対策。実行方法の獲得知識を
    仕様の教訓より優先して記録するルールをAGENTS.md/learnings_template/
    retrospectiveスキル/test/releaseに追加。
  - **A-3 ナビゲーション責務**: 操作手順の暗記前提はスケールしない。全エージェントが
    「次の一手」を案内する責務をAGENTS.mdに、入口表を `harness-guide` スキルに、
    ヘルプを `/98-harness-help` に実装。
  - **A-4 セッション分割基準の数値化**: USAGE.mdに表（フェーズ別+継続中の4条件:
    完了タスク10個超/差し戻し2往復超/劣化を感じた/中断）。implementに10タスク超での
    新チャット提案を追加。
  - **A-5 起動経路の等価性ルール+全プロンプト監査**: ハンドオフ経由では.prompt.mdが
    読まれないため「振る舞いの正は.agent.md、プロンプトは薄い起動指示」をAGENTS.mdに
    明文化。監査の結果、00（番号規則→harness-guideへ）/01（memo不在時の対応→
    requirementsへ）/04（詳細設計の項目リスト→designへ）/05（粒度・紐づけ→implementへ）
    を移設し、該当プロンプトを薄化。02/03/06-10/99は問題なし。
    権限整合も点検し、実行不能な指示は検出されなかった。
  - **A-6 差分駆動の原則+ホットフィックス乖離追跡**: 「要件・設計を後から修正する場合」
    節を4分類に拡張。緊急対応は「絶対禁止」ではなく「記録すれば許容」に倒す
    （禁止すると障害時に必ず破られ、破られたルールは記録すらされないため）。
  - **A-7 横断整合監査**: gate-checkスキルに成果物間の食い違い検出（Spec Kitの
    /speckit.analyze相当）を追加。前回比較（D015前後）で認識していたSpec Kit劣位点の解消。
  - **A-8 workflows保護**: guard-harness-config-editの保護対象に .github/workflows/ を
    追加（CI/CDもガードレールの一部）。実機検証済み。
  - **A-9 .gitattributes+BOM規則**: Windows(autocrlf)でのクローンで.shがCRLF化して
    フック全滅する事故と、.ps1のBOM欠落事故（D012・派生版でも再発）の再発防止。
  - **A-10 ZIP配布手順**: 入手3経路をUSAGEに明記。`git archive`による安全なZIP作成と
    「向き先」事故（受領者がハーネス本体へ誤push）の防止。
  - **A-11 適用範囲+PRテンプレート**: READMEに「使うべき場面・使うべきでない場面」を明記
    （過剰さへの一番の防御は対象外の作業に使わせないこと）。トレーサビリティ・
    検証・安全性・rollbackを含むPRテンプレートを追加。

## D019: databricks検証からの還流（B項目群・Databricks固有を汎用化）

- **B-1 reviewer頻出指摘の前倒し**: SQL文字列直接連結・異常系の例外任せを
  task-workerの禁止事項に昇格（レビューで検出できるが実装時点で止める方が安い）。
  「reviewerで2回以上出た同種指摘は禁止事項へ昇格提案」の運用ルールを
  retrospectiveスキルに追加。
- **B-2 環境前提の実機確認**: environment.md記載を鵜呑みにしてゲート通過→実装で
  大幅手戻り、というE2E実測欠陥への対策。spec-criticの観点を「実機確認済みか」まで
  強化し、releaseに着手時の疎通確認を追加。
- **B-3 cold start対策の標準化**: 外部サービス依存テストはタイムアウト付きポーリングを
  標準とする（単発即時応答のassertは偽陰性を生む。実測）。test-case-designに追加。
- **B-4 冪等な初期化**: deploy Skillに前提リソースの冪等な初期化手順を必須化
  （「デプロイは成功するが初回実行で落ちる」の典型原因。実測）。skill-authoringに追加。
- **B-5 MCPはHooks検査対象外**: Hooksはネイティブコマンド文字列しか検査できず、
  MCPツール呼び出しはすり抜ける。最小権限の原則をAGENTS.mdセキュリティ節に明記。

## D020: test→releaseの send:true を維持（C-1の判断）

- **決定**: Databricks版は「リリース=重い本番承認」のため send:false に変更したが、
  CreateAppl は environment.md 駆動の自動リリース（ノンストップ設計）が
  アイデンティティであるため **send:true を維持**する。
- **整合**: USAGE.mdのセッション分割表には「リリース: 自動継続（ノンストップ設計）。
  手動で再開する場合は新チャット+/09でも同じ動作」と記載し矛盾をなくした。
  破壊的操作の確認はHooks（ask）とenvironment.mdの人手分類で担保される。

## D021: CIワークフローは設計フェーズで生成する（C-2の判断）

- **決定**: CreateApplはスタック非依存のため具体的なCIを同梱できない。選択肢(a)の
  プレースホルダ同梱ではなく **(b)「設計フェーズでスタック確定後に skill-authoring で
  生成する」を明文化** した（skill-authoringにCI/CDの扱い節を追加）。
- **原則**: 「参照される仕組みには実体を同梱するか、無いことを明記する」は採用。
  プレースホルダを置かない理由は、TODOだけのworkflowはCIが通っている錯覚を生むため。

## D022: E2E検証用サンプルの同梱は保留（C-3の判断）

- **決定**: Databricks版で大きな効果があったsamples/（検証フィクスチャ）の
  CreateAppl版は、**次にCreateAppl自体のE2E検証を実施するタイミングで作成する**として保留。
- **理由**: フィクスチャは実際にE2Eを回して初めて価値が出る（Databricks版の効果も
  検証実行とセット）。作る際は「本体リポジトリ上で検証しない。配布経路で作った
  使い捨てプロジェクトで行う」という検証運用ルールを必ず併記する。

## D023: UIデザインゲート（ui-design-mockup）の新設

- **決定**: ブラウザUIを持つアプリでは、設計フェーズで主要画面を自己完結型HTML
  モックアップ（`docs/02-design/ui/`、ダブルクリックで表示可能）として作成し、
  ユーザーの視覚確認を設計ゲート承認の前提条件とする。spec-criticはUIありなのに
  モックアップ無しをMAJOR指摘し、testはPlaywrightスクリーンショットとモックアップの
  乖離を検出する。
- **根拠**: 実際のハーネス利用で「実装後に画面デザインが考慮されていないと判明」する
  事象が発生。調査の結果、2026年の業界到達点は「Requirement → Design（インタラクティブな
  HTMLプロトタイプを視覚レビュー）→ Plan → Code → Verify」であり、モックアップは
  別ツールではなく**コードと同じワークスペースのファイルとして同じエージェントが
  生成・反復する**形が最新（superdesign等）。Spec Kit・BMADには視覚デザインゲートが無く、
  この領域は本ハーネスの差別化点になる。
- **コスト設計**: 生成は1画面1回のモデル呼び出し、**閲覧はブラウザで開くだけで
  トークンコスト・ゼロ**。全画面ではなく主要フロー+代表画面に絞る。修正はチャット指示と
  HTML直接編集の両方を受け付ける（ユーザーの提案どおり）。UIの無いアプリではスキップ。
- **捨てた選択肢**: Figma MCP連携を既定にすること（外部サービス依存・認証が必要で、
  汎用テンプレートの既定にはできない。Figmaを使うプロジェクトでは設計フェーズで
  接続すればよい）。


## D024: 次の一手の案内はプロンプトコマンド形式に統一

- **決定**: フェーズ移行時の案内を「新しいチャットで `/03-design-architecture` を実行」の
  ようなコマンド形式に統一し、「◯◯エージェントに切り替えて」という案内を禁止した。
  ハンドオフボタンは「同一チャット続行用」と位置づけ、ラベルにも
  「（このチャットで続行）」と明示。requirements/designのゲート後案内も
  コマンド形式を第一とし、ハンドオフを補足に格下げした。
- **根拠**: CreateApplの実機E2Eで実測された案内の不正確さ。要件定義完了時に
  「新しいチャットを開き、designエージェントに切り替えてから設計フェーズを開始」と
  案内された。(1) プロンプトは `agent:` バインドで自動的に正しいエージェントとして
  動くため手動切り替えは不要、(2) エージェント切り替えだけではプロンプトの起動指示
  （どの段階から始めるか）が実行されない、(3) ハンドオフ（同一チャット継続）と
  セッション分割表（新規チャット推奨）が矛盾したまま両方を混ぜた案内になっていた、
  の3点が原因。案内フォーマットの規定（AGENTS.mdナビゲーション責務・harness-guide）と
  ゲート後案内の書き換えで解消した。

## D025: マルチプラットフォーム対応（Copilot / Claude Code / Antigravity）

- **決定**: 「正のレイヤ + 薄いアダプタ」構成で3環境対応した。振る舞いの正は従来どおり
  `AGENTS.md` + `.github/`（agents/prompts/skills/hooks）に一本化し、各環境には
  ポインタだけのアダプタを置く（生成スクリプトで機械生成・冪等）。
  - Claude Code: `CLAUDE.md`（`@AGENTS.md`インポート）、`.claude/commands/`（13件）、
    `.claude/agents/`（reviewer/spec-critic/task-worker）、`.claude/skills/`（9件のポインタ）、
    `.claude/settings.json`（既存フックスクリプトをClaude Codeスキーマで配線）
  - Antigravity: `AGENTS.md` を直接読む + `.agents/workflows/`（13件）
- **調査根拠**（2026年7月時点の一次情報）:
  - Claude Code は AGENTS.md を直接サポートせず（[issue #31005](https://github.com/anthropics/claude-code/issues/31005)、
    3000超のupvoteに未対応）、スキルも `.claude/skills/` しか探索しない
    （`.agents/skills/` へのsymlinkは内部ファイル汚染で機能しない）。
    そのため CLAUDE.md のインポート機能とポインタスキルで橋渡しする。
  - Claude Code のフック（`.claude/settings.json`）はVS Code版と同一のペイロード仕様
    （tool_input.file_path/command、hookSpecificOutput.permissionDecision）のため、
    **既存スクリプトを無変更で共用**できる（VS CodeがClaude Code形式を採用した経緯による）。
    Claude Code の SessionStart は compaction 後にも発火する（source=compact）ため、
    PreCompact 相当の再注入も SessionStart 登録だけでカバーされる。
  - Antigravity は v1.20.3 でプロジェクトレベルの AGENTS.md を正式サポート。
    `.agents/` が特別ディレクトリで、`.agents/workflows/*.md` が /コマンドになる
    （[Google Codelabs](https://codelabs.developers.google.com/autonomous-ai-developer-pipelines-antigravity)）。
    フック機構は無いため、ガードレールは指示レベル+Git保護に縮退する（対応表に明記）。
- **設計原則**: アダプタは振る舞いを持たない（起動経路の等価性ルールA-5の
  プラットフォーム拡張）。読み替え規則（runSubagent→Task/別会話）はアダプタ内と
  AGENTS.mdに明記。ガードも拡張し、アダプタ層（CLAUDE.md/.claude設定・agents・
  commands/.agents/workflows）を保護対象に追加（`.claude/skills/` は動的Skill作成の
  ため除外）。skill-authoringに「正のスキル新設時はClaude用ポインタも同時作成」を追加。
- **捨てた選択肢**: (a) 各環境に振る舞いをコピーする（必ずドリフトする）。
  (b) Claude Codeプラグイン化（インストール手順が増え、テンプレートのクローン即利用に反する）。
  (c) 正を `.claude/skills/` へ移す（Copilotは読めるが、既存の全相互参照の書き換えと
  Antigravity非対応で利点が薄い）。

## D026: ai-manager（姉妹プロジェクト）からの知見採用

- **出典**: 同一作者の別プロジェクト ai-manager（AI秘書。Antigravityを主環境として
  同じ「正典＋薄いポインタ」構成でマルチエージェント対応済み）の PORTABILITY.md。
  設計思想が独立に一致していることを確認した上で、相互比較で見つかった差分のうち
  ハーネス側に欠けていた3点を採用した。
- **採用した項目**:
  1. **Antigravity IDEはプロジェクト内スクリプトフックを読まない**（ai-managerでの
     実機検証により判明）。機械的保護はIDEのDeny List（Settings → Permissions →
     Advanced）への手動登録で代替する。AGENTS.md・README・.agents/workflows
     アダプタ（生成文言）に反映。
  2. **`permissions.deny` の併用**: `.claude/settings.json` にツールレベルの
     ハードブロック（ハーネス設定ファイルとテンプレートへのEdit/Write禁止）を追加。
     フックと合わせて二重の機械的ガードとなり、Claude Codeが3環境で最も強い
     ガードレールを持つ。ハーネス本体の保守時は人間が一時的にdeny行を外す運用
     （CLAUDE.mdに明記）。
  3. **機能別の劣化モード明記**: READMEの対応表に「対応度の目安」を追加し、
     環境ごとに何がフルで何が劣化かを利用者が着手前に判断できるようにした。
- **逆方向の還流**: ハーネス側が優位だった「ポインタの機械生成（冪等スクリプト）+
  validatorによる乖離検出」は、ai-manager向けの改善指示書
  （D:\vscode-worspace\ai-manager-improvement-handover.md）として別途まとめた
  （ai-managerはポインタを手作業維持しており、転写忘れによるドリフトのリスクがあるため）。

## D027: アダプタ生成・整合検証ツールをリポジトリに同梱

- **決定**: これまで開発セッションの作業領域にしか存在しなかったアダプタ生成スクリプトと
  整合性バリデータを `tools/generate-adapters.py` / `tools/validate-harness.py` として
  リポジトリに同梱した。skill-authoring スキルの「ポインタ同時作成」手順も
  ツール実行を第一の方法に更新した。
- **根拠**: GAS派生ハーネス構築指示書を多プラットフォーム対応(D025)に合わせて改訂する際、
  派生側がアダプタを再生成・検証する手段を持たないことが判明した。これは自分たちが
  D021で定めた「参照される仕組みには実体を同梱するか、無いことを明記する」原則への
  違反だったため解消した。同梱版はパスをスクリプト位置からの相対に変更し、
  冪等性（再実行で差分ゼロ）を確認済み。ai-manager向け還流指示書(I-1/I-2)で
  他プロジェクトに勧めた内容を、自分自身にも適用した形。

## D028: 大規模開発対応（サブシステム分割モード）と dynamic workflows の位置づけ

- **決定**: 大規模案件（US目安30超・複数サブシステム・複数チーム）向けに
  `large-scale-development` スキルを新設した。構造変更ではなく「スキル+テンプレート+
  少量の配線」で吸収し、標準の単一パイプラインは従来どおり既定とする。
  - 2層構造: システム層（全体要件・サブシステム分割・ICD・統合テスト・リリース）+
    サブシステム層（標準docs構造のミラー。テンプレートは既存の*_template.mdを再利用）
  - `docs/02-design/interface_contract_template.md`（ICD）を新設。agreed後の変更は
    影響サブシステム全部の再ゲートを伴う変更管理として扱う（差分駆動の原則の契約適用）
  - AIと人の責任分界を明文化: **サブシステムの内側はAI、境界（分割・ICD・統合・リリース）は
    人が承認**。境界の誤りだけが全体に波及するため人の注意をそこに集中させる
  - 並列化はプラットフォーム非依存の並行セッション/worktreeが基本。Claude Code
    (Max/Team)では dynamic workflows（2026-05-28導入の多数サブエージェント並列機能）を
    コスト増の明示+ユーザー承認つきで提案可とした（CLAUDE.mdに読み替えを記載）
- **根拠**: BMAD METHODの[document sharding](https://docs.bmad-method.org/how-to/customization/shard-large-documents/)
  （巨大PRDをepic単位に分割しエージェントのコンテキストを最適化する）、GitHub Spec Kitの
  機能単位spec、システムズエンジニアリングのICD実践。「単一巨大文書は人にもAIにも
  読めなくなる」が業界の共通結論であり、本ハーネスの弱点（成果物が単一ファイル前提・
  パイプラインが単線）と一致したため、確立された分割パターンを採用した。
- **既知の制約（正直に記録）**: SessionStart注入と warn-stale-gate フックはシステム層の
  パスしか検知しない。サブシステム側のゲート整合は指示レベル運用であり、実案件で摩擦が
  大きければフック拡張を検討する（スキル内に明記済み）。
- **検証事故（教訓）**: この適用作業中、`permissions.deny`（D026）が実際に発動し
  テンプレート新設がブロックされた。ガードが機能している実証である一方、保守作業は
  スクラッチ経由のコピーで回避した。Bashによるファイル操作はpermissions.denyの
  Edit/Write指定では止まらないことも確認された（既知の限界として記録。
  完全な防御にはGit側の保護=ブランチ保護/CODEOWNERSの併用が必要）。

## D029: ブラウザ検証を「コード化テスト主・対話操作従」の2層に変更

- **決定**: テストフェーズのブラウザ検証を、D013の「Playwright MCPで開いて確認し、
  コードとして残せるものは残す」（MCP主・コード従）から反転させ、
  **受け入れ条件の検証はPlaywrightテストコード+CLI実行を主**、対話型ブラウザ操作は
  (a)モックアップとの視覚比較 (b)失敗デバッグ (c)コード化前の探索 の3用途に限定した。
  対話操作の手段はプラットフォームネイティブを選ぶ:
  Copilot=Playwright MCP(.vscode/mcp.json) / Claude Code=Playwright MCP(.mcp.json、
  キー名mcpServers) / Antigravity=内蔵ブラウザエージェント(CDP直結・拡張不要・動画証跡)。
- **根拠**: 2026年の実測ベンチマークで、同一カバレッジのブラウザ検証が対話型MCP操作では
  約114Kトークン、コード化テストのCLI実行では約27Kトークン（約1/4）
  ([ytyng 2026ベンチマーク](https://www.ytyng.com/en/blog/ai-browser-automation-tools-comparison-2026)、
  [TestQuality 2026アーキテクチャガイド](https://testquality.com/playwright-test-agents-mcp-architecture-2026/))。
  実務コンセンサスは「MCPは探索・即席検証、回帰保護はコード化されたPlaywright」の併用。
  コード化はトークン以外にも、決定的・再実行可能・資産としてリポジトリに残り
  改修サイクルとCIに再利用できる点で「docs/が正」の設計思想と一致する。
  Playwright MCP自体は引き続きエージェント向けブラウザ操作の業界標準であり廃止しない。
- **捨てた選択肢**: agent-browser(Vercel系、ページ表現200-400トークンでMCP比高効率)の
  既定採用 — 有望だが新しく単一ベンダー依存のため、既定はMicrosoft参照実装のMCPを維持し
  動向を注視する。Claude in Chromeの既定採用 — chrome-extension://コンテキスト等の
  既知の制約があり成熟途上のため見送り。

## D030: 鮮度監査（2026-07-06実施）の結果と修正

- **監査内容**: 「現時点のベストプラクティスを採用しているか」を構成要素ごとに
  最新情報（VS Code Copilot 5-6月チェンジログ・各領域の実務動向）と突き合わせた。
- **現行どおりで問題なし**: custom agents(.agent.md)・Agent Skills（段階的開示・
  agentskills.io標準）・Agent Hooks（8イベント・Preview）・prompt files の agent: バインド・
  handoffs・model:auto（AI Credit課金）・AGENTS.md標準（Copilot/Antigravityネイティブ、
  Claude CodeはCLAUDE.md経由のまま変化なし）・マルチプラットフォームアダプタ構成・
  EARS/spec-driven・UIモックアップゲート・コンテキストロット対策・成長ループ。
  5-6月の新機能（Agents window、リモートエージェント、enterprise-managed plugins）に
  本ハーネスの構成を壊す変更は無い。
- **修正した項目**:
  1. ブラウザ検証の主従逆転（D029）。
  2. **Copilotのスキル二重読み込み防止**: VS Codeはプロジェクトスキルを
     `.github/skills` に加えて `.claude/skills` からも探索するため、D025で置いた
     Claude用ポインタが Copilot 側で正と二重に発見される恐れがある。
     `.vscode/settings.json` に `chat.agentSkillsLocations: { ".claude/skills": false }`
     を設定して正のみを読ませるようにした（実機で挙動確認できたら再評価する）。
- **残課題（記録のみ）**: brownfield（既存コードベースへの適用）対応はSpec Kitの
  /speckit.converge相当が未実装のまま（D-比較時から既知）。最初のbrownfield案件の
  振り返りを起点に対応する。

## D031: brownfield（既存コードベース）対応の実装

- **決定**: `brownfield-intake` スキルと `/11-brownfield-intake` プロンプトを新設した。
  実装済みコードから as-is 要件・アーキテクチャ・環境情報を docs/ に逆起こしし、
  spec-critic レビュー + gate-check 横断整合監査で文書とコードの整合を検証
  （Spec Kit `/speckit.converge` 相当）してから GATE_STATUS を初期化し、
  以後は差分駆動の改修サイクル（D014/A-6）に接続する。
- **設計原則**: (1) as-is と to-be を混ぜない（改善要望は改修候補リストへ分離。
  混ぜると差分駆動の「どこからが変更か」が壊れる）。(2) 全コードを文書化しない
  （触る領域+システムの背骨に絞り、残りは「未逆起こし」と明記）。
  (3) environment.md は実機確認（B-2の教訓の適用）。
  (4) 大規模既存システムは large-scale-development と併用。
- **根拠**: 競合比較（D015前後）およびD030の鮮度監査で「greenfield前提でbrownfield
  未対応」が唯一の既知ギャップとして残っていた。Spec Kitのconverge、BMADのbrownfield
  対応が示すとおり、実務の多数派は既存コードベースへの適用であり、
  「世界最高」を名乗る上で放置できない欠落だったため実装した。

## D032: Dagram v0.1.0 振り返りからの還流（成長ループの実例2周目）

- **出典**: Dagram v0.1.0 の `/10-retrospective`（2026-07-08実施）による改善提案6件。
  ユーザーの明示指示のもとハーネス本体（このリポジトリ）に適用した（D017の還流経路）。
  実装〜テスト区間の人的ブロッカー0回・テスト起因のプロダクト修正0件で完走した
  プロジェクトであり、摩擦は主に「知見の未収録」に集中していた。
- **適用した項目**:
  1. **ui-design-mockup**: モックアップの各状態（ダイアログ・ポップアップ等）は
     状態切替バーだけでなく**実際の動線（＋ボタン・ノードクリック等）から開ける配線を必須化**
     （摩擦#1: 切替バーからしか開けない登録ダイアログが「画面がない」と2回指摘され、
     設計往復が1回増えた）。
  2. **deploy-local-npx テンプレを新設収録**: ホスティング先を持たないローカル完結アプリ
     （CLI・`npx`実行形式）のリリース手順（`npm ci → build → npx .` 起動確認・
     annotatedタグ・ロールバック=Git revertのみ）を、プロジェクト固有値を除いた
     汎用テンプレとして `.github/skills/deploy-local-npx/` に収録し、
     skill-authoring とrelease から参照。固有値（ポート等）は追記欄でプロジェクトごとに
     確定させる方式（全環境の事前収録はしない方針は維持）。
  3. **release**: CI結果確認の gh CLI 依存を解消。未導入環境では GitHub REST API への
     HTTP GET（公開リポジトリは認証不要）で代替するフォールバックを明記（摩擦#5）。
  4. **release**: リリースタグは **annotated（`git tag -a`）で作成**を明記。
     lightweight タグは `git push --follow-tags` の送信対象外のため、使う場合は
     明示 push する（摩擦#6: v0.1.0 タグが送信されない事故が実際に発生）。
  5. **learnings_template**: Windows で cwd のドライブレターが小文字だと Vitest が
     モジュール二重ロードでテスト全滅する既知問題をシード例として収録（摩擦#3。
     learnings 注入により後続フェーズで再発ゼロ = 記録の効果が実証済みの知見のため、
     新プロジェクトに最初から効かせる）。
  6. **test-case-design**: E2Eブラウザ自動化固有の落とし穴2点（HTML5 D&Dはマウス合成
     イベントで発火しない→DataTransfer付きDragEventをdispatch・headlessは
     beforeunloadダイアログを出さない→reload+dialogイベント待ち）を追記
     （摩擦#4: E2E初回9件失敗の主因。プロダクト側の欠陥は0件だった）。
- **還流しなかったもの**: stack-conventions（中身がDagram固有。「プロジェクトごとに
  設計フェーズで作る」というハーネスの仕組みどおりに機能したため、実体の還流は不要）。
- **適用手順の記録（ガードレールの実効確認）**: `.github/agents/` と
  `docs/**/*_template.md` への変更は permissions.deny が Edit を、加えて auto モードの
  分類器が Bash `cp` による迂回もブロックした（D028時点では「Bashはdenyで止まらない」が
  既知の限界だったが、現在は分類器が迂回として検出・拒否することを実機確認。
  ガードは当時より強くなっている）。適用は CLAUDE.md 記載の正規手順どおり、
  人間が deny 行4行を一時的に外し、適用後に復元した。
- **運用ルール確認**: reviewer で2回以上出た同種指摘は該当なし（B-1の昇格対象なし）。

## D033: Team Operations Hub v1.0.0 振り返りからの還流（成長ループ3周目）

- **出典**: Team Operations Hub v1.0.0 の `/10-retrospective`（2026-07-19実施）による
  改善提案4件。ユーザーの明示指示のもと適用した。実装〜テスト区間の人的ブロッカー0回・
  テスト起因のプロダクト修正0件・上流指摘（要件MAJOR 7/設計MAJOR 4）を全てゲート前に
  解消という、D032（Dagram）に続き「上流で検出し下流でゼロ」を再現したプロジェクト。
- **適用した項目**:
  1. **windows-shell-conventions スキルを新設**: Windows + Git Bash + PowerShell 併用環境の
     既知の落とし穴7種（ドライブレター大小文字・`git stash -u`×autocrlf のCRLF事故・
     PowerShellインライン呼び出しの構文崩壊・curl 日本語ボディの文字化け・
     heredoc/Edit のバックスラッシュ破壊・Volta シムと環境変数差し替え・
     パイプの SIGPIPE）を汎用スキルとして集約。内容は同プロジェクトの
     `learnings.md`（2026-07-13〜07-17）の実記録から固有値を除いて汎用化した。
     共通原則「複雑なワンライナーを書かずスクリプトファイルにする」を冒頭に明記。
     プロジェクトごとの再発見コスト（うち1件は実プロダクトバグ化）を解消する。
  2. **フック判定ログ**: 判定を持つ全フックスクリプト（guard 4種 + warn-stale-gate、
     bash/PowerShell 両系統の計10ファイル）に、deny/ask/warn 判定時のみ
     `.github/hooks/logs/hook-decisions.log`（gitignore対象・ローカルのみ）へ
     日時・スクリプト名・判定・対象を1行追記する処理を追加。振り返りの
     「フック発火回数と誤検知」項目が2プロジェクト連続で「不明」だった穴を塞ぐ。
     設計上の要点: (a) ログ失敗はフック判定に影響させない（フェイルセーフ）、
     (b) **guard-secret-leak はシークレット本文を絶対にログへ書かず**パターン種別のみ
     記録、(c) 許可(allow)時は記録しない（ノイズと肥大化の防止）。
     D012の教訓に従い、適用前(scratchpad)と適用後(本番パス)の両方で bash/ps1 とも
     サンプルペイロードによる実機検証を行い、判定JSONが原本と同一であることと
     ログ追記・BOM保持を確認した。
  3. **requirements-elicitation に「画面横断の仕様を先に確認する」節を追加**:
     複数行テキスト項目の役割分担・一覧/ガント等の共通UI規約（フィルタ・トグル・
     遷移導線）・主用途の重み付けを要件定義段階で確認する。モックアップレビューで
     都度発覚するとユーザー指示の往復が画面数ぶん増える（実測: 6巡）ため、
     ui-design-mockup（D023/D032-1）の往復回数を上流で減らす。
  4. **重大度語彙の対応表**: spec-critic（BLOCKER/MAJOR/MINOR）と
     reviewer/security-review（CRITICAL/HIGH/MEDIUM/LOW/INFO）の読み替え
     （BLOCKER≒CRITICAL/HIGH、MAJOR≒MEDIUM、MINOR≒LOW/INFO）を
     security-review スキルに追記。語彙の統一はしない（両者の出典・用途が異なり、
     振り返りの集計には対応表で足りるため）。
- **還流しなかったもの**: stack-conventions（Team Operations Hub 固有。
  「mdファイルをデータストアとして扱う保全パターン」の一般化は、同種アプリの
  2例目が出た時点で判断する）。
- **適用手順**: D032と同じ正規手順（人間が `.claude/settings.json` の該当deny行
  = 今回は `.github/hooks/**` の2行を一時的に外し、適用後に復元）。

## D034: 会話型マルチエージェント（Agent Teams等）への対応方針

- **経緯**: 「複数の専門エージェント（サブエージェント）が専門分野を担いつつ、
  他のエージェントと会話しながら進める動きが世の中にあるが、本ハーネスはそうなって
  いるか。画面デザイン専門エージェント等を置くメリットはあるか」というユーザーの
  問いを受け、Web調査（2026-07-19実施）で最新動向を確認した上で方針を決めた。
- **調査結果（2026-07時点）**: マルチエージェント開発ツールは2層に分化している。
  1. **SDLC工程ハーネス層**（Spec Kit / BMAD / Kiro / 本ハーネス）: 文書媒介・
     逐次フェーズ・人間ゲートが共通解。BMADは約10ペルソナ（UX expert含む）と
     役割分割が最も細かいが、それでも協調は文書の受け渡しで、人間がメッセージバス役。
     エージェント間の自由会話を採るものは無い（MetaGPT系研究の知見も「対話より文書」）。
  2. **実行オーケストレーション層**（oh-my-claudecode: 19-32専門エージェント+
     共有タスクリスト+Autopilot/Ultrapilot/Swarm等の実行モード /
     oh-my-opencode(omo)のSisyphus: 階層委譲+並列バックグラウンド実行 /
     Ruflo(旧claude-flow): 60+エージェント・mesh/階層等のトポロジー選択可 /
     SuperClaude）: **実装実行の並列化・加速**が目的の別カテゴリで、こちらは
     多数の専門エージェント化が実際に主流化している。
  3. **Anthropic公式の Agent Teams**（Claude Code実験的機能・既定オフ・
     環境変数で有効化）: リードがチームメイトセッションを起動し、共有タスクリストから
     各自が仕事を取り、**チームメイト同士が直接通信する**。公式docsは従来の
     サブエージェント（結果報告のみ・相互会話なし = 本ハーネスの現方式）と
     明確に区別している。推奨規模3-5体・トークン消費は大きい。
- **決定**: 現行アーキテクチャ（階層型1往復委譲 + 文書媒介 + 4つの既定経路）を維持する。
  - 上流（要件・設計・独立レビュー）は**会話させないことが独立性の本質**（D004/D016）で
    あり、会話型に変える理由がない。コンテキストロット対策（D011）・監査性
    （会話は揮発するがdocs/は残る）・コストの根拠も不変。
  - 専門性はエージェント分割ではなくスキル（ui-design-mockup等）+人間の視覚ゲート
    （D023）で担う方針も維持（追加のモデル呼び出しコストがゼロで済むため）。
- **将来の検討条件（先回りで実装しない。実測した摩擦を根拠に還流する = D017/YAGNI）**:
  1. Agent Teams が実験的機能を卒業して安定化したら、**全自動区間（implement〜test）の
     並列化オプション**として検討する。本ハーネスの `tasks.md` は Agent Teams の
     「共有タスクリスト」とほぼ同型のため、implement→task-worker の逐次委譲を
     並列ワーカーに置き換える拡張は構造変更なしに載る。位置づけは D028 の
     dynamic workflows と同じ（コスト増の明示 + ユーザー承認のオプトイン）。
     上流フェーズには適用しない（独立性を壊すため）。
  2. UI比重の大きいプロジェクトで design フェーズの往復が重くなる実測が出たら、
     ui-designer サブエージェント（design→ui-designer、既存4経路と同パターンの
     文脈分離）の追加を検討する（BMADのUX expert相当）。
- **出典**（2026-07-19閲覧）:
  [Claude Code Docs: Agent teams](https://code.claude.com/docs/en/agent-teams)、
  [oh-my-claudecode](https://github.com/yeachan-heo/oh-my-claudecode)、
  [Oh My OpenAgent (Sisyphus)](https://ohmyopenagent.com/)、
  [claudefa.st マルチエージェント6フレームワーク比較](https://claudefa.st/blog/tools/orchestrators/multi-agent-orchestrators)

## D035: Team Operations Hub v1.1.x/v1.2.0 振り返りからの還流（成長ループ4周目）

- **出典**: Team Operations Hub の retrospective-3.md（2026-07-26実施。v1.2.0 対象）の
  改善提案8件。うち R2-1〜R2-4 は retrospective-2.md（v1.1.x）の未適用持ち越し分で、
  retrospective-3 の5節に4点セットのまま統合されたもの。ユーザーの明示指示のもと適用した。
- **適用した項目**:
  1. **R2-1 adr-writing**: 外部CLI/ツール連携の可否・呼び出し方式を決めるADRは、
     ドキュメント読解だけでなく最小限の hands-on 実行確認（実際に1回叩いて
     入力経路/出力形式/制約値を確認）を必須化。根拠: ADR-0007 が文書参照のみで
     「実装可能」と判断し、`copilot -p` の stdin 非対応をリリース後の実機確認まで
     見落とした（C-2 → v1.1.1 パッチ）。
  2. **R2-2 test-case-design**: 外部ツール/APIの接続テストは「応答の有無」でなく
     「期待内容の含有」を検証する（検証可能な応答を指示。例:「OKとだけ答えよ」。
     空応答・エラー文言を成功と誤判定しない）。根拠: 「応答があれば成功」の設計で
     外部CLIのエラー文言でも接続テストが成立し、C-2 の発覚が遅れた。
  3. **N-1 test-case-design**: 観点チェックリストに「アップグレード経路（差分リリース時）」
     を追加。旧バージョンで初期化・運用されたデータからの起動・移行を必ず1ケース以上含める。
     根拠: R-1 [HIGH] = v1.1.x 初期化済みフォルダで新マスタ2種が生成されず登録不能。
     Vitest 1,399 + E2E 112 件が全て新規シード前提で素通しし、reviewer だけが検出した。
  4. **N-2 ui-design-mockup**: 「項目の配置・グルーピングは業務の意味で決める。
     データの出自（外部システム由来・転記元フィールド名との一致）は内部事情であり
     画面構造に持ち込まない」を作り方に追加し、アンチパターンにも追記。
     根拠: A-022 = 出自ベースの「連携項目」セクションがユーザー訂正を受け、
     意味順の統合配置に変更となった。
  5. **N-3 windows-shell-conventions**: §4（curl 日本語）にクエリ文字列変種を追記。
     `--data-urlencode` でも不成立で「静かに合致しない」形で現れる。日本語を含む
     API 検証は node の `fetch` + `URL.searchParams` で行う。根拠: TASK-904 で
     タグ絞り込み検証が常に0件になった（D033-1 の既存節の変種）。
  6. **N-5 harness-retrospective**: 還流方法の節に「個別プロジェクトのセッションから
     本体リポジトリを直接編集しない。直接適用の指示があっても正規フローを案内し、
     最低1回は確認を促す」を明記。根拠: 摩擦 #7 = 「マージして」の指示を本体直接適用と
     解釈して実行し、ユーザー訂正を受けた（2026-07-26）。
  7. **R2-3 CLAUDE.md（対応表）**: Claude Code（autoモード）では `git tag` の
     ローカル作成が権限ガードに拒否される一方 `git push origin main` は許可される
     非対称があるため、「タグ付けはエージェントが実行を試みず、annotated タグの
     コマンドを提示してユーザーに実行してもらう」運用を対応表に明記した。
     根拠: v1.1.0 リリースでこの制約に遭遇し、以後この運用で v1.1.1・v1.2.0 が安定。
  8. **R2-4 release.agent.md（手順6）**: 複数の人手確認項目に一括「OK」を
     受けた場合、続行前に項目ごとに問題がなかったかを一言で再確認する（推奨・必須化は
     しない）を追記した。根拠: v1.1.0 の実環境確認5点で一括OK後、タグ付け完了後に
     1点のみNGの訂正が入った。
- **見送った項目（N-4）**: 差分設計の「既存機構を無変更で流用」主張を実コードと
  突き合わせる手順の design 側への追加。spec-critic が現にゲート前検出しており
  （MAJOR 3件）多層防御が機能しているため、同種の見落としが spec-critic を通過した
  実例が出たら再提案する（「迷ったら適用見送りに倒す」基準の適用）。
- **適用手順**: retrospective-3 の5節に明記された正規フロー（本体リポジトリを開いた
  セッションで適用）に従った。`.github/skills/` と DECISIONS.md は deny 対象外
  （D006: スキルは動的追加を許す）のためそのまま適用。保護対象2件（R2-3/R2-4）は
  D032/D033 と同じく、人間が該当 deny 行4行（CLAUDE.md と `.github/agents/**` の
  Edit/Write）を一時的に外した上で適用し、適用後に復元した。
- **運用ルール確認**: reviewer で2回以上出た同種指摘は該当なし（B-1 の昇格対象なし）。

## D036: 還流適用コマンド /90-apply-retrospective と harness-maintainer エージェントの新設

- **経緯**: 「改善提案を取り込むコマンド（プロンプト）は用意していないか」という
  ユーザーの問いが起点。還流の適用は D017 で意図的に人間の作業としてきたが、
  D032・D033・D035 と同一手順（本体を開いたセッションで振り返りファイルを読ませて適用し、
  DECISIONS.md に記録し、保護対象は人間が deny 一時解除）を3回繰り返して手順が
  安定したため、D035 の適用と同じセッションでユーザーの指示によりコマンド化した。
- **決定**:
  - `.github/skills/harness-apply-retrospective/SKILL.md`（手順の正: 本体リポジトリ
    確認 → 提案の仕分け → 適用 → 保護対象の deny 解除依頼 → アダプタ再生成・整合検証 →
    DECISIONS.md 記録 → **deny 復元確認** → コミット提案）と
    `.github/prompts/90-apply-retrospective.prompt.md`（薄い起動指示）を新設。
    番号 90 は「本体保守（本体リポジトリ専用）」の新区分（harness-guide の番号規則に追記）。
  - バインド先として `.github/agents/harness-maintainer.agent.md` を新設
    （tools: read/edit/search/execute、agents: []、model 非固定）。
  - README 対応表・USAGE §7・harness-guide 入口表・harness-retrospective 還流方法・
    AGENTS.md（エージェント構成・成長ループ3）に案内を反映。
- **人間がゲートである原則（D006/D017）は変えない**: 保護対象の編集は人間の deny
  一時解除経由のまま。スキルに「deny 復元の確認まで行う」「Bash で deny を迂回しない」
  「提案表に無い変更を混ぜない」を明文化し、個別プロジェクトからの直接編集禁止
  （D035 N-5）を前提確認として組み込んだ。コマンドは適用作業を再現可能にするもので、
  承認の所在を変えるものではない。
- **捨てた選択肢**: orchestrator への相乗りバインド（役割定義「自分では中身を書かない」と
  矛盾し、`execute` が無く生成ツール・git を実行できない。D008 の「プロンプトは正しい
  ツール制限のエージェントにバインドする」原則に反する）。アダプタの手書き作成
  （D027 の生成ツールが正規手順。手書きはドリフトの温床）。
- **検証記録**: 新設セッションで、エージェントによる `python tools/generate-adapters.py`
  実行が auto モード分類器にブロックされた（生成ツールが保護対象パス
  `.claude/commands/` 等へ書き込むため。D032 の「Bash 迂回のブロック」と同じ挙動で、
  ガードが機能している実証）。このためアダプタ生成コマンドはユーザーに提示して
  実行してもらう運用とし、スキルとエージェント定義の両方にフォールバックとして明文化した。

## D037: Team Operations Hub v1.3.0/v1.4.0 振り返りからの還流（成長ループ5周目・フックfail-open修正）

- **出典**: Team Operations Hub の retrospective-4.md（2026-07-27 実施。v1.3.0 対象。
  未適用のまま1サイクル持ち越された N4-1〜N4-7）と retrospective-5.md（2026-07-29 実施。
  v1.4.0 対象。新規 N5-1〜N5-5）の計12件。ユーザーの明示指示のもと
  `/90-apply-retrospective`（D036 の新設コマンドの初の実運用）で適用した。
  なお N4-1（windows-shell-conventions）・N4-2（test-case-design）・
  N4-6（adr-writing）・N4-7（deploy-local-npx）の4件は、本セッション開始時点で
  ワーキングツリーに前セッション由来の未コミット適用済み差分として存在しており、
  提案表との照合で忠実な適用であることを確認してそのまま採用した。
- **最重要（フック3本の fail-open 修正。N4-3/N4-4）**: `.sh` 版フックが2つの欠陥で
  **黙って fail-open** しており、Claude Code（`.claude/settings.json` は全OSで bash 固定）
  ではガードが実質不在だった。v1.3.0/v1.4.0 の2サイクル連続で判定ログ0件という形で
  しか表面化しなかった（実害は無し。learnings.md の暫定教訓が安全網として機能）。
  1. `guard-dangerous-git.sh`: JSON抽出が素朴な grep のため、値中のエスケープ済み
     引用符 `\"` で切れて危険判定に到達しない（`cd "D:/…" && git push` が素通し。全OSで発生）。
  2. `guard-harness-config-edit.sh`・`warn-stale-gate.sh`（`guard-template-edit.sh` も
     同じ抽出）: パス照合が `/` 区切り前提で、Claude Code が Windows で渡す `\` 区切り
     パスに一致しない（`.ps1` 版は `[\\/]` で対応済み。実装間で保護レベルが乖離）。
  - **修正**: 4スクリプトとも JSON解析（jq → node → python → 全滅時のみ grep フォールバック）
    に変更し、パスは `\`→`/` 正規化後に照合。README に「JSONを素朴なgrepで読まない」
    「変更後は selftest 実行」の規約を追記。
  - **検証**: `selftest.sh` を新設（提案表外だが両振り返りの「適用後の検証」節が明示的に
    推奨）。修正版は scratchpad・本番パスとも 13/13 PASS。**ネガティブコントロール**
    （修正前スクリプトに同テスト）で振り返り報告どおりの4件 FAIL を再現し、
    欠陥の実在と selftest の検出能力の両方を実証した。適用後、判定ログ
    （D033-2 の機構）が初めて実際に生成されることも確認した。
- **N4-5（ガードの二重化の正確化）**: `.claude/settings.json` テンプレートに
  `permissions.ask`（`Bash(git push:*)`/`git tag`/`git reset --hard`）を追加し、
  フックが壊れてもツール層の確認が残る本当の二重化にした。AGENTS.md の
  「二重の機械的ガード」記述を「deny はファイル編集のパスのみ・コマンド系はフック + ask」
  へ正確化（ログが空である事実を2サイクル「発火しなかった」と誤読した反省を含む）。
- **N5-1〜N5-5（v1.4.0 新規）**:
  1. **N5-1 test-case-design**: E2E落とし穴に「要素数・矩形などの基準値は描画完了を
     待ってから取る」（`count()` は描画を待たない。単独実行で通り全件実行・別マシンで
     落ちる flake になる）。同クラス3回目での昇格（B-1 運用ルール適合）。
  2. **N5-2 ui-design-mockup**: 「色を識別チャネルに使う設計は目視でなく数値で検証」節を
     新設（ΔE・コントラスト比・CVD の実測、淡いティントは identity に不適、実測値を ADR に
     残す）。根拠: 淡いティント8色案が ΔE 3.7（合格15）で不合格と実測され設計変更に至った
     （目視のみなら通過していた）。
  3. **N5-3 ui-design-mockup**: 組み合わせの多い要素は画面別に分散させず
     「状態リファレンス」1枚に集約する項目を追加（8状態×4画面を1枚で設計確認・実装照合・
     E2E視覚比較に共用し乖離0件の実例）。
  4. **N5-4 design/implement/reviewer.agent.md**: 差分設計の「配線網羅表」（接続点を
     1行1IDで列挙し、型エラーにならず静かに欠ける箇所に★印）を詳細設計の必須項目・
     タスク紐づけ・レビュー全行照合として正の層に収録（個別プロジェクトが編み出し
     2サイクル欠落0件で実証した運用の一般化）。
  5. **N5-5 harness-retrospective / harness-apply-retrospective**: 還流が済むまで
     progress.md 申し送り（SessionStart 注入に乗る）と learnings.md の暫定回避行動を
     残す「未適用マーカー」手順と、還流完了時にそれを消す完了処理を追加。
     根拠: retrospective-4 の7件が未適用のまま1サイクル放置され、どこにも警告が
     出なかった（learnings.md の暫定教訓だけが実害を防いだ＝有効性実証済みの規約化）。
- **見送った項目**: なし（12件すべて適用。追加で selftest.sh を上記理由で作成）。
- **B-1 昇格対象の確認**: reviewer 同種指摘の2回以上は該当なし（該当した同種反復は
  テスト側の flake 3回で、N5-1 として test-case-design へ昇格済み）。
- **適用手順**: 正規フロー。`.github/skills/` と DECISIONS.md はそのまま適用。
  保護対象は人間が deny 6行（`.github/hooks/**` の Edit/Write・`.github/agents/**` の
  Edit・`AGENTS.md` の Edit・`.claude/settings.json` の Edit）を一時解除して適用し、
  適用後に復元（`permissions.ask` の追加のみ意図した差分として残す）。
  自己ブロック回避のため `guard-harness-config-edit.sh` の修正は全保護対象編集の
  最後に実施した（先に直すと、修正されたフック自身が以後の保護対象編集を deny するため）。
  アダプタは本文を持たないポインタのため再生成不要（スキル新設・description 変更なし。
  `tools/validate-harness.py` エラー0・警告0を確認）。

## D038: 逆同期コマンド /91-sync-from-harness と sync-harness.py の新設（成長ループの3辺目）

- **経緯**: D037 適用直後の「振り返り→本体反映→プロジェクト反映という一連の流れを
  もう少し手順化・自動化したい」というユーザー要望が起点。ループの3辺のうち
  「プロジェクト→振り返り」（/10）と「振り返り→本体」（/90、D036）はコマンド化済みだが、
  **「本体→プロジェクト（逆同期）」だけが毎回アドリブ**で、retrospective-4 の7件が
  2サイクル放置された遠因にもなっていた（本体に適用してもプロジェクト側の
  フック・エージェント定義は古いコピーのまま。ガードレールの修正ほど取り残しが危険）。
- **決定**:
  - `tools/sync-harness.py` を新設（generate-adapters.py と同じ決定的・冪等ツール）。
    ハーネス所有ファイルの**マニフェスト**を内蔵し、プロジェクト固有物には触れない。
    既定は dry-run で、レポートをプロジェクト側 `docs/00-overview/harness-sync-report.md`
    に書き出す（execute を持たない orchestrator でもレポートを読んで進められる）。
    `--apply` は**人間が実行**する。これによりプロジェクト側の deny 一時解除の儀式が
    丸ごと不要になる（人間がゲートの原則は不変。エージェント権限ではなく人間の実行で
    保護対象に書く）。バージョンは DECISIONS.md の**D番号を流用**（「D037 まで適用済み」）。
  - **要レビュー分類**: 両側に存在して差分がある `deploy-*` スキル（プロジェクト固有値表を
    持つ混在ファイル）・README/USAGE/CODEOWNERS は自動上書きせず、差分提示のみ
    （汎用部分だけを手動マージ。新規追加は壊すものが無いため自動）。**削除はしない**。
  - `.github/skills/harness-sync/SKILL.md`（手順の正）と
    `.github/prompts/91-sync-from-harness.prompt.md`（薄い起動指示。**orchestrator に
    バインド**: スクリプト実行は人間の担当なので execute 不要、レポート読解と docs 更新は
    read/edit で足りる。D036 が /90 で orchestrator を退けた理由=execute 不在が、
    /91 では設計上そもそも不要）を新設。番号規則を「90番台=ハーネス保守
    （90=還流適用・本体専用 / 91=逆同期・プロジェクト側）」に拡張し、
    harness-guide・harness-retrospective・harness-apply-retrospective に配線。
- **実装知見（実測）**: 初回 dry-run で「更新65件」と出たが、実体は大半が
  **改行コード差のみ**（本体working tree=LF・プロジェクト=CRLF）だった。
  `.gitattributes` の `* text=auto` と同じ意味論で比較を EOL 正規化した結果、
  実質差分の19件（=D037適用分+過去の取り残し1件）に収束。要レビュー分類も
  `deploy-local-npx`（固有値表が埋まっている）を正しく自動上書きから除外した。
- **捨てた選択肢**: (a) 本体を git remote として merge する方式 — ZIP配布（A-10）で
  作られた既存プロジェクトは履歴を共有せず、`--allow-unrelated-histories` の初回マージが
  全面衝突になる。新規プロジェクトの将来オプションとしては有望だが既定にしない。
  (b) エージェントがプロジェクト側で直接編集 — 保護対象ごとに deny 解除の往復が発生し、
  「毎回指示するのが面倒」という問題を解決しない。(c) 本体側で消えたファイルの自動削除 —
  プロジェクト固有物の誤削除リスクに対して利得が小さく、安全側（手動）に倒した。

## D039: effort-metrics v1.0.0/v1.1.0 振り返りからの還流（成長ループ6周目・教訓注入の欠陥修正）

- **出典**: effort-metrics の retrospective.md（2026-08-02 実施。v1.0.0 全工程 +
  C-11/C-12/C-13 差分サイクル + v1.1.0 実配布。94タスク・Vitest 4,601件・E2E 44件・
  教訓207件の大規模プロジェクト）による改善提案12件 + Skill 還流2本。
  ユーザーの明示指示のもと `/90-apply-retrospective` で適用した。**見送りなし（全件適用）**。
- **最重要（#1 教訓注入の silent 打ち切り修正）**: `inject-progress.sh` / `.ps1` が教訓を
  **最も古い50件**で打ち切っており、教訓が50件を超えた時点から**新しい教訓が1件も
  注入されなくなる**欠陥があった（207件中157件 — テスト・リリースフェーズの実行知全部 —
  が一度も注入されないまま全工程が終わった実測。警告も出ないため誰も気づけない）。
  **新しい50件（tail）** に変更し、上限超過時は「N件中 新しい50件のみ表示」の打ち切りを
  注入文に必ず明示。AGENTS.md 成長ループに上限を注記し、`harness-retrospective` に
  「上限到達時は振り返りで棚卸しする」運用ルールを追加した。
- **リリース安全性（#2〜#6）**:
  - #2 人手必須タスクを `👤` 記法で区別し、ドラフト出力で `[x]` にしない
    （implement.agent.md / tasks_template / gate-check）。CI 等の検証基盤は最初の
    人手依頼として直ちに提示する（未配置のまま5セッション持ち越され CI 初回実行が
    リリース直前で4ジョブ一斉失敗した実例）。
  - #3 利用者の運用作業（導入・更新・バックアップ・復旧）の自動化境界を要件で聞く
    （requirements-elicitation / environment_template）。「手順書に書く」は自動化の代替ではない。
  - #4 「2回目以降のインストール＝更新経路」を要件・テスト・リリースの対象にする
    （elicitation / test-case-design / deploy-local-npx / deploy-local-zip）。
    手順書どおりの更新で利用者データが全消失する内容が実運用まで発覚しなかった実例。
  - #5 push 前の PR state 確認・push 後の run 確認（release.agent.md / deploy 両スキル）。
    マージ済み PR のブランチへの push は CI も走らず main にも入らない。
  - #6 配布物の検査は CI の実物を `gh run download`（deploy-local-zip）。`--prefix` は
    ローカル生成物では見えず、タグ後に判明して次版送りになった実例。
- **プロセス（#7・#10）**: 差分駆動の原則に 5.「小規模な要件追加」（影響範囲の閉包提示・
  spec-critic 省略はユーザー明示承認・省略記録）を追加（AGENTS.md / gate-check）。
  progress.md 申し送りのリリース時退避ルール（progress_template / gate-check。879行の実例）。
- **#12 check-doc-chars フック新設**: `docs/**.md` 書き込み後に不可視文字・文字化け
  （NUL/本文中BOM/ハングル/置換文字/生タブ/全角空白/BMP外漢字）を数えて警告する
  PostToolUse フック（sh/ps1・gate-hooks.json・.claude/settings.json 配線・
  AGENTS.md ドキュメント規約）。docs は lint 対象外で機械検査が皆無だった。
- **#8/#9/#11**: `mutation-verification` スキル新設（実行方法・1箇所置換検査・生き残りの
  切り分け順序・等価変異カタログ。task-worker から任意参照）／test-case-design の境界値に
  「値中の区切り文字」追加（実データ初回取込で後方非互換変更に至った実例）／
  windows-shell-conventions に3件追記（CommandLine 照合の自己 kill・再帰削除の権限ガード
  拒否は Move-Item 退避で代替・ユーザーに渡すコマンドは PowerShell 1行でシェル明示）。
- **Skill 還流**: `deploy-local-zip` を汎用化して新設（deploy-local-npx と並ぶ配布形態。
  実行権限の罠・実物検査・タグ打ち直し禁止・更新経路を含む）。`stack-conventions` は
  還流しない（提案どおり。プロジェクト固有）。
- **B-1 昇格対象の確認**: reviewer 同種指摘2回以上は該当なし（reviewer HIGH は
  全工程で1件のみ。上流 spec-critic の BLOCKER 13/MAJOR 45 が実装前に吸収した）。
- **適用手順の進化（重要）**: D037 でフックが正しく機能するようになった結果、
  **deny 行の一時解除だけでは保護対象を編集できなくなった**（フック層が独立に deny する。
  ガードが働いている証拠）。今回から、scratchpad で実機検証済みの適用スクリプト
  （apply.py: 置換ペア全一致検証 → 書き込みの2段階・BOM/CRLF 保持）を**人間が1コマンド
  実行する方式**を確立し、`harness-apply-retrospective` に標準手順として明文化した
  （deny 解除・復元の儀式が不要になり、ガードは適用作業中も有効なまま）。
- **検証**: selftest を18ケースに拡張（check-doc-chars 3・inject-progress 2 を追加）。
  scratchpad → 本番とも **18/18 PASS**。`.ps1` 版は PowerShell 5.1 実機で検証
  （教訓60件フィクスチャで newest-50 + 打ち切り明示、NUL 検出を確認）。
  validate-harness エラー0・BOM 確認・JSON 妥当性確認済み。
- **実装時に踏んだ既知の穴（記録）**: ①複数行 `node -e` の出力消失
  （windows-shell-conventions §5 記載どおり。1行化で解消）②ツール呼び出しの JSON 層が
  `\uXXXX` を実文字にデコードする現象（§5 の「Edit ツールが \uXXXX を実文字に変換」の
  根本原因と推定）。check-doc-chars 自身に検査対象の不可視文字が2度混入し、
  スキル記載の回避策（`[char]0xXXXX` / `RegExp("\\uXXXX")` で組み立てる）で解消した
  — 検査フックの実装自体が、このフックの必要性の実証になった。

## D040: トークン利用の計測基盤（effort-log）の導入とモデル選択方針

- **出典**: ユーザー要望（2026-08-02。「ハーネスでのアプリ構築は高精度でできるように
  なったが、トークン/コストが把握できない。工程・エージェント・モデル別に把握したい。
  振り返りにトークン効率の観点を入れたい」）。設計ディスカッションと実機検証を経て適用。
- **決定1（記録は都度・レポートは振り返り時）**: Claude Code の **Stop + SessionEnd**
  フックに配線した `log-effort.py` が、トランスクリプトJSONLを集計して
  `docs/00-overview/effort-log.csv` に upsert する（1行 = セッション×エージェント×モデル。
  input/output/cache_read/cache_write(5m/1h) を分離記録）。振り返り時にまとめて集計
  しない理由: トランスクリプト保持期間が既定30日で、長いプロジェクトでは振り返り時に
  序盤のデータが消えているため。レポートは `tools/effort-report.py` がいつでも再生成できる
  （工程・エージェント・モデル別 + 単価表による推定USDコスト。単価は改定されるため
  CSVには持たせずレポート生成時に乗算）。
- **決定2（帰属の取り方）**: フェーズ = セッション先頭のスラッシュコマンド
  （`<command-`で始まる user エントリのみ判定。ツール入力中の言及で誤検出した実例への
  回帰テストあり）。エージェント = `subagents/agent-*.jsonl` を Task の
  `subagent_type`→`agentId` 対応（フォールバック: `attributionAgent`）で紐づけ。
  ストリーミングの途中経過が同一 message.id で複数行記録されるため **後勝ちで重複排除**。
- **決定3（安全設計）**: トランスクリプトJSONLは公式に「内部形式・バージョン間で
  変わりうる」ため、ロガーは全例外を握りつぶして常に exit 0（Stop フックは exit 2 が
  ターンをブロックするため特に厳守）、壊れた既存CSVは上書きしない（データ保護優先）。
  `docs/00-overview/progress.md` が存在するリポジトリのみ記録する（ハーネス本体の
  保守セッションでテンプレートを汚さないためのゲート）。自己テストは
  `python .github/hooks/scripts/log-effort.py --selftest`（10ケース）。
  組織規模で必要になったら公式の OpenTelemetry メトリクス
  （`claude_code.token.usage`。model/agent.name/query_source 属性あり）へ移行する。
- **決定4（劣化モード）**: 自動計測は Claude Code のみ。Copilot はトークン数非開示
  （premium request 数のみ）、Antigravity はフック不可。ガードレールと同様の
  「機能別劣化モード」として AGENTS.md コスト節に明文化。
- **決定5（モデル選択方針。ユーザー承認済み・適用は計測1サイクル後）**: Claude Code に
  自動モデルルーターは存在しない（サブエージェントのモデル解決順序は
  `CLAUDE_CODE_SUBAGENT_MODEL` env → 呼び出し時指定 → frontmatter `model:` → inherit）。
  方針: メイン会話はユーザー選択を尊重（現状 Fable 5）、`task-worker` は
  `model: sonnet`（コスト構造の支配項。Sonnet 5 は $3/$15 で Fable の1/3以下）、
  `reviewer`/`spec-critic` は inherit 維持（手戻りコスト > モデル代）。
  **まず現状のまま1プロジェクト計測し、実測（task-workerの消費割合・品質差し戻し）を
  見てから task-worker の Sonnet 化を確定する**。一括で強いモデルに戻したいときは
  `CLAUDE_CODE_SUBAGENT_MODEL=fable`（harness-guide に記載）。
- **振り返りへの還流**: retrospective_template に数値行（総トークン・推定コスト・
  最大消費工程）と「トークン効率」の問い（モデル適切性・無駄・上流品質との相関 =
  spec-critic の費用対効果を実測で検証）を追加。harness-retrospective の情報源に
  effort-report.md を追加。
- **実装時に確立した実行知（windows-shell-conventions §10/§11 に還流）**:
  PowerShell 5.1 のパイプは stdin 先頭に UTF-8 BOM を付けることがある
  （`json.load` が失敗。`lstrip(chr(0xFEFF))` で除去。BOM をリテラルで
  ソースに埋め込まない）。PowerShell 5.1 の `ConvertFrom-Json` は
  トランスクリプトJSONLの行でパース失敗するため、JSONL解析はPythonで書く。
- **実測の初期データ**: 直近3セッションで input 137K / output 829K /
  cache_read **262M** / cache_write 5.5M トークン（API換算 約$339）。cache_read が
  支配的であることが確認され、種別単価分離（読取0.1x/書込1.25x・2x）の設計が
  裏づけられた。

## D041: ハーネス文書のルート退避（.github/harness/）とアプリREADMEのパイプライン化

- **出典**: 個人利用中のユーザー指摘（2026-08-02）。ハーネスで開発したアプリの
  リポジトリを開いても、ルートの README / USAGE がハーネスの説明のままで、
  アプリの説明や使い方がパッと見て分からない（アプリリポジトリとして本来の構成でない）。
- **問題の本質は2つ**: (1) ルートの README.md / USAGE.md / overview.html が
  ハーネス所有のままプロジェクトに残り続ける。(2) アプリのREADMEを作る工程が
  パイプラインのどこにも存在しない（`.github/agents/` に README への言及ゼロ）。
- **決定1（配置）**: ハーネス所有の使い方文書を `.github/harness/` に分離
  （USAGE.md・overview.html を移動し、案内用の薄い README.md を新設）。
  ルート README.md はハーネス本体リポジトリではテンプレートの顔として現行内容を維持し、
  プロジェクトではアプリのREADMEに置き換わるライフサイクルを冒頭に注記。
  ハーネスREADMEの全文複製は `.github/harness/` に**置かない**（同内容の正が2つになり
  乖離するため。「正のレイヤ+薄いアダプタ」の原則どおり構造説明の正はルートREADME1つ）。
  `.github/README.md` 直下も使わない（GitHubがルートREADMEより優先表示する仕様のため、
  アプリのREADMEを覆い隠してしまう）。
- **決定2（パイプライン）**: orchestrator の初期化（手順1）に「ルートREADMEが
  ハーネスの説明のままならアプリ用スタブに差し替える」を追加し、release の手順に
  「リリースチェックリストの一環としてルートREADMEを docs の要件・設計から
  正式なアプリREADMEにする」を追加（いずれも保護対象ファイルのため人間が適用）。
- **決定3（同期）**: sync-harness.py の SYNC_GLOBS に `.github/harness/**/*` を追加
  （ハーネス所有・自動同期）。ルート USAGE.md をマニフェストと REVIEW_FILES から除去。
  README.md は引き続き要レビュー（プロジェクトのアプリREADMEを自動上書きしない）。
- **参照更新**: AGENTS.md の USAGE.md 参照3箇所（保護対象・人間が適用）、
  harness-guide / brownfield-intake スキル、ルートREADME内リンク、
  overview.html フッターリンク。

## D042: 既存アプリの一括展開向け取り込み自動化（tools/intake-app.py と経路A/Bの整理）

- **出典**: ユーザーとの設計対話（2026-08-02）。多数の既存アプリ（AI開発ではない・
  要件/設計書が体系化されていない・git管理されていない場合もある）へハーネスを
  展開する構想。機械的なセットアップを人手やモデルにやらせない自動化の要望。
- **決定1（ツール）**: `tools/intake-app.py` を新設。テンプレート複製
  （本体HEADの `git archive`。`.git`・ローカル設定が構造的に混入しない）→
  既存アプリを `app/`（`--dir`で変更可）配下へ**無仕分けで**コピー（`.git`/`__pycache__`/
  `node_modules` は除外）→ `git init` → 初回コミット → 取り込みレポート
  （`docs/00-overview/intake-report.md`）までを決定的に自動化。sync-harness.py と
  同じ流儀（既定dry-run・`--apply`で書き込み・事前検査NGは何も書かず中止）。
  事前検査 = 本体誤認（progress.md/intake-report.md の存在でプロジェクトをテンプレに
  誤用するのを防止）・予約名衝突・入れ子パス・非空の作成先。テンプレートの
  `.gitignore` に食われたアプリ内ファイル（`dist/` 等）も明示的に報告する。
  本体が非git（ZIPダウンロードの展開コピー。ユーザーの実運用で発覚）の場合は、
  ローカル専用物（フックログ・settings.local.json 等）を除外したフォルダコピーに
  自動フォールバックする（git archive と同等のクリーンなテンプレートを保つ）。
- **決定2（経路の整理）**: brownfield導入は「経路A（標準）= テンプレートベースで
  `app/` 配下へ取り込み」「経路B（git履歴を保全したい場合のみ）= 既存リポジトリへ
  ハーネスを注入」の2経路として brownfield-intake スキルに明文化。従来はBのみ記載で、
  A案の是非をめぐる議論の混乱の根本原因が「経路Aの欠落」だった。
- **決定3（AI設定資産の扱い）**: 既存アプリ内のAI設定（`.github/` `.claude/` 等）は
  無仕分けで持ち込んでよい。エージェント設定の探索はルート起点のため `app/` 配下では
  不活性になる。**唯一の例外は Claude Code がサブディレクトリの CLAUDE.md / AGENTS.md を
  配下の作業時に自動読込すること**で、これのみ「実効性あり」として棚卸し
  （知識回収 → `.pre-harness` リネームをユーザー承認つきで提案）の対象にする。
  旧CI（`app/.github/workflows/`）はルートでしか実行されないため改修候補リスト送り。
  分担は「検知=スクリプト（機械）・判断=エージェント（/11）・アプリ側改変の承認=人」。
- **根拠**: 機械的なセットアップはモデル経由より決定的スクリプトの方がコストと
  確実性の両面で優れる（Hooks優先の原則と同型）。`app/` 1フォルダへの無仕分け配置は
  アプリ内部の相対パスを無傷に保ち、as-is確定前の再編成（アンチパターン）を構造的に
  防ぐ。git履歴の保全だけが経路選択の本質的な判断軸であることは対話で確認済み。

## D043: 受付ルーチンと変更請求フェーズの新設（プレーンチャットからハーネスを起動する）

- **出典**: 個人利用中のユーザー報告（2026-08-07）。**ハーネス未適用の既存プロジェクトへ
  ハーネスを持ち込んだが、まったく機能しなかった**。症状は「スラッシュコマンドの案内を
  しない」「改善の記録を残さない」「タスク作成らしき動きはするがハーネスとして動いていない」
  「何度ハーネスに従えと言っても従わない」「指摘すると謝るが改善しない」
  「『ここはスラッシュコマンドでは？』と聞くと『そうです』と言う」。
  結果として**ユーザーがハーネスを操縦する**状態になり、ハーネスの目的（ハーネスが
  開発をコントロールする）が完全に失われた。ユーザー評価: 過去の改善を1とすると
  今回の需要は100万レベル。
- **問題の本質は「モデルの不遵守」ではなく、ハーネス側の構造的な4つの穴**:
  1. **プレーンチャットに入口が無い**。振る舞いの正は `.github/agents/*.agent.md` にあり、
     それが読まれるのは**スラッシュコマンド実行時だけ**。普通のチャットで依頼すると
     素のエージェントが動く。AGENTS.md は「こういう設計になっている」という説明文で、
     「依頼を受けたら最初にこうしろ」という命令が1行も存在しなかった
     （ナビゲーション責務は「案内する」であって「入口に入る」ではない）。
  2. **運用中プロジェクトの依頼に行き先が無い**。`/01`〜`/10` は初回構築の一本道で、
     `/11-brownfield-intake` 完了後は全フェーズ `done` になるが、その状態で
     「機能を追加して」に対応するコマンドが**存在しなかった**。従おうとしても行き先が
     無いため、場当たり作業に落ちるのが構造上の必然だった。
  3. **配線の欠落を検出する手段が無い**。USAGE.md「0. 準備」経路3（既存リポジトリへの
     注入）のコピー対象リストに **`CLAUDE.md` と `.claude/` が入っていなかった**
     （brownfield-intake スキル側の記述とは食い違っていた）。Claude Code は AGENTS.md を
     直接読まないため、`CLAUDE.md` が無ければハーネスの指示は一切読まれず、
     `.claude/commands/` が無ければスラッシュコマンド自体が存在しない。
     既存リポジトリに元から `CLAUDE.md` がある場合の衝突も未記載だった。
     **配線切れの症状は「エージェントが指示に従わない」という行動の問題に見える**ため、
     ユーザーもエージェントも原因にたどり着けない（今回の報告と完全に一致する）。
  4. **機械的強制がハーネス自身の保護にしか使われていない**。フックは設定ファイル保護・
     秘密漏洩・危険gitのみで、「フェーズ外で実装を始める」は素通り。しかも文脈注入は
     SessionStart の1回だけで、会話が伸びるほど薄まる。
     「モデルに繰り返し指示して守らせるよりHooksで機械的に強制する」という
     AGENTS.md 自身の原則が、**最重要のルールにだけ適用されていなかった**。
- **決定1（受付ルーチン）**: `.github/skills/request-routing/SKILL.md` を新設。
  ハーネス適用済みプロジェクトで依頼を受けたら、着手前に (1) GATE_STATUS を読む →
  (2) 依頼を分類する（内容の表が優先、曖昧なら GATE_STATUS の表）→
  (3) **応答の冒頭で「分類 / 入口 / 影響範囲」を宣言する** → (4) 入口に入る、を必ず行う。
  AGENTS.md の冒頭（プラットフォーム説明より前）に、この最優先ルールの要約を置く。
- **決定2（案内ではなく起動）**: 「入口に入る」を、従来の「ユーザーにコマンド実行を
  案内する」から **「エージェントが自分でコマンドを起動する」** に変更した。
  Claude Code では `.claude/commands/*.md` が Skill ツールから起動できるため、
  受付から実行までをエージェント側で閉じられる。案内で止めてよいのは
  セッション分割表が新規セッションを要求する場合のみ。**ユーザーに入口を指定させている
  時点でハーネスは機能していない**、を明文のルールにした。
  自己起動できない Copilot / Antigravity ではコマンド名の提示に劣化する
  （ガードレール同様の「機能別の劣化モード」）。
- **決定3（変更請求フェーズ `/12`）**: `.github/skills/change-request/SKILL.md`、
  `.github/prompts/12-change-request.prompt.md`、`.github/agents/change.agent.md`、
  各アダプタを新設。全フェーズ `done` = 「プロジェクト完了」ではなく **「運用中」** と
  定義し直し、その状態の入口を `/12` にした。差分駆動の4分類を3つの質問で機械的に
  判定し、影響範囲をトレーサビリティから辿り、該当フェーズだけ再ゲートする。
  変更履歴は `docs/00-overview/change-requests.md`（変更請求台帳）に1件1行で残す
  （「改善の記録もしなかった」への直接の対策。記録先が無いから記録されなかった）。
- **決定4（毎ターンの注入）**: `route-request` フック（UserPromptSubmit）を新設。
  現在の GATE_STATUS の要約と受付ルーチンの契約を**依頼のたび**に注入する。
  SessionStart の1回だけでは会話が伸びるほど薄まるため。シェル実行でほぼゼロコスト。
- **決定5（フェーズ外実装の機械的停止）**: `guard-phase-scope` フック（PreToolUse）を新設。
  `progress.md` があり、どのフェーズも `in_progress` でない状態で、docs/ 等の
  ハーネス管理領域**以外**のファイル（＝アプリのコード）を編集しようとしたら **ask** で止め、
  `/12-change-request` を経由するよう促す。deny ではなく ask にしたのは、緊急対応や
  例外を人が1操作で通せるようにするため。正しく `/12` に入っていれば
  implementation が `in_progress` になるので発火しない（ゲート状態を正直に保つ強制力にもなる）。
- **決定6（記録漏れの停止）**: `remind-record` フック（Stop）を新設。アプリのコードを
  変更したのに `docs/00-overview/` に何も残っていない状態で終了しようとしたら
  1回だけブロックする（`stop_hook_active` でループを防ぐ）。教訓・台帳への記録は
  「気づいたら書く」任せでは実測で書かれなかったため、機械的なトリガを与える。
- **決定7（配線確認の義務化）**: brownfield-intake スキルに手順1.5「導入の配線確認」を
  追加（`CLAUDE.md` の `@AGENTS.md`、`.claude/commands/`、`.claude/skills/`、
  hooks の発火、テンプレートの有無を機械的に確認する表）。USAGE.md 経路3のコピー対象に
  `CLAUDE.md` `.claude/` `.agents/` を追加し、既存ファイルとの衝突時の退避手順を明記。
  さらに手順7「運用中モードへの引き渡し」を追加し、取り込み完了時に
  改修候補リストを CR として起票し、**「以後は普通のチャットで言ってください」という
  運用契約をユーザーに明示する**ことを必須にした（「導入完了」で終わらせない）。
- **決定8（保守モードの実行可能化）**: `tools/harness-maintenance.py` を新設。
  従来 CLAUDE.md は「人間が `permissions.deny` の該当行を外す」と案内していたが、
  **`guard-harness-config-edit` フック層が残るため実際には編集できない**（手順が
  そもそも成立していなかった）。本ツールは deny とフックの両方をまとめて退避／復元する。
  ガードを外すツールをエージェントに実行させないため、確認文字列の対話入力を必須にした
  （エージェントの Bash は stdin が null デバイスのため EOFError で失敗する）。
- **根拠**: 今回の失敗は「指示が足りない」ではなく「入口が存在しない」「行き先が無い」
  「配線が切れていても分からない」という構造の欠落であり、指示を強めても直らない
  （実際、ユーザーが何度指示しても直らなかった）。ハーネスの既存原則
  「Hooksで機械的に強制する方がコストと確実性の両面で優れる」を、最も重要なルール
  （入口に入ること・記録すること）にようやく適用した。ユーザーがコマンドを暗記する
  前提はスケールしないという AGENTS.md のナビゲーション責務を、
  「案内する」から「エージェントが自分で入る」へ一段引き上げたのが本改善の核心。

### D043 再点検での追加決定（モデル切替後のレビューで検出。2026-08-07）

- **追加1（振り分けの状態依存）**: 変更依頼を無条件に `/12` へ振ると、**構築中**
  （いずれかのフェーズが in_progress）の仕様変更まで CR にしてしまう。`/12` は
  運用中（全done）の入口であり、構築中の変更は差し戻し（`/02`/`/03`/`/06`）が正。
  request-routing の内容優先表を状態依存に修正（緊急HFのみ状態を問わない）。
- **追加2（本体リポジトリの誤認防止）**: progress.md が無い場合の振り分けに
  「`DECISIONS.md` あり = ハーネス本体。アプリ開発の入口を使わない」の行を追加。
  また「既存コードがあるのに `/00-start-project` を実行するとグリーンフィールドの
  一本道が始まる」罠を明記。
- **追加3（分類2の既定レビュー）**: change-request スキルに「再ゲート承認前に
  spec-critic を1回（差分に絞る）」を既定として明記（従来は省略条件しか書かれず、
  既定で実施することが読み取れなかった）。あわせて大型の分類2（アーキテクチャ波及・
  複数US・影響タスク10超）は `/12` で受付〜CR起票までとし、以後は新チャットで
  `/03`（または `/02`）に乗せるセッション分割規定を追加。
- **追加4（経路3コピーリストの再修正）**: 決定7で修正した USAGE.md 経路3リストに
  `tools/` が漏れていた（無いと `/91-sync-from-harness` が実行できず、以後ハーネスの
  改善を取り込めない）。同種バグの再発であり、コピーリストの完全性は目視でなく
  照合可能な正（sync-harness.py の SYNC_GLOBS）と突き合わせるべきという教訓。
- **追加5（保守ツールの防壁強化）**: `echo "確認文字列" | python ...` のパイプ供給で
  確認入力が成立してしまう穴を isatty 検査で閉じた（パイプ/リダイレクトを拒否。
  直接実行は入力する人間がいなければタイムアウトで不成立。権限分類器の
  ブロックと合わせ三重の防壁。実機で isatty の挙動を確認済み）。
- **追加6（保守モードでの適用項目に追加）**: inject-progress.sh の progress.md 欠如時
  メッセージが「/00-start-project を実行」固定なのは brownfield で誤誘導になる
  （既存アプリに /00 は誤り）。本体リポジトリ（DECISIONS.md あり）では本体向けの案内、
  プロジェクトでは「新規なら /00、既存アプリの取り込みなら /11」の両論併記に直す。
  全フェーズ done のときは「運用中。入口は /12」を1行加える。
  orchestrator.agent.md の手順1（progress.md をテンプレから自動作成）にも
  brownfield 検知（intake-report.md / app/ / ソースコードの存在）時は作成せず
  /11 へ誘導する分岐を追加する。
- **追加7（Copilot の劣化モード確定）**: gate-hooks.json を実査した結果、Copilot の
  フックに UserPromptSubmit 相当のイベントは無い（PreToolUse / PostToolUse /
  SessionStart / PreCompact のみ）。決定4の毎ターン注入は Claude Code 専用となり、
  Copilot は SessionStart/PreCompact 注入 + AGENTS.md の指示レベル、Antigravity は
  指示レベルのみ、という機能別劣化モードを AGENTS.md のガードレール強度差の節に追記する。

### D043 適用の記録

全決定を2026-08-07に適用完了(保守モード `tools/harness-maintenance.py --on` の下で実施)。
適用時の検証: `tools/validate-harness.py` エラー0件・警告0件、
`.github/hooks/scripts/selftest.sh` 27件全PASS(新フック3本のテスト9件を含む)。

適用中に確定した追加事項:
- `.claude/settings.json` に **PreCompact フックが未配線**だったのを発見し追加
  (Copilot 側 gate-hooks.json には配線済みだった非対称。圧縮でGATE_STATUS注入が
  失われる穴は Claude Code にも存在した。長い会話でハーネスが効かなくなる
  今回の症状に直結しうる欠落)。
- 新フックの配線は `.claude/settings.json` と退避中の `settings.json.locked` の
  **両方**に施した(保守モード解除の復元で消えないように。strip_guards の期待値
  一致を検証済み)。
- `guard-phase-scope.ps1` は新規作成時に **UTF-8 BOM 無し**になっており、
  hooks README の編集規則(PS 5.1はBOM無しUTF-8日本語をパースできずフック全滅)に
  従いBOMを付与した。Write系ツールでの .ps1 新規作成は必ずBOM検査すること。
- remind-record.py の stdout は Windows で CP932 になり得るため
  `sys.stdout.reconfigure(encoding="utf-8")` を必須とした(フックJSONはUTF-8前提)。

## D044: ハーネス導入・更新の全自動化（--init 注入と harness-origin による本体パス記憶）

- **出典**: ユーザーの設計提案（2026-08-07、D043 の直後）。「手動コピーは漏れるので
  注入も自動にする。ハーネス側からプロジェクトを与えて実行する。コピーされた
  プロジェクトで『ハーネス更新』と指示すればローカルの最新ハーネスから更新される。
  ローカルのハーネスの場所は記憶されるか」。D043 で判明した「経路Bの手動コピーリスト
  漏れ（CLAUDE.md / .claude/ / tools/ の欠落）がハーネス全停止の直接原因」の恒久対策。
- **決定1（--init 注入モード）**: `tools/sync-harness.py` に `--init` を新設。
  本体側から `--project <既存リポジトリ> --init [--apply]` で、ハーネス未適用の
  既存リポジトリへ SYNC_GLOBS 全ファイルを**新規追加のみ**で注入する。
  **既存ファイルとの衝突は一切上書きせず**レポートに列挙し、処理は /11 の
  AI設定資産棚卸し（知識回収 → .pre-harness リネームの承認つき提案）へ委ねる。
  適用時に intake-report.md（/11 の入力マーカー）も生成する。dry-run では対象
  リポジトリに一切書き込まない（レポートは stdout のみ）。安全検査: 対象が本体に
  見える場合と適用済み（progress.md あり）の場合は中止、非gitはレポートで警告。
  経路Bの手動コピーリストは USAGE.md / brownfield-intake スキルから撤去し、
  このコマンドに置換（コピー対象の正は SYNC_GLOBS の1箇所になった）。
- **決定2（本体パスの自動記憶）**: 従来、本体パスは記憶されず /91 のたびにユーザーへ
  質問していた。`docs/00-overview/harness-origin.md` に機械可読ブロック
  （HARNESS_ORIGIN: path / version / synced）を新設し、intake-app.py（経路A）と
  sync-harness.py の `--apply`（--init 含む）が自動で書く・更新する。
  sync-harness.py は `--harness` 省略時にこの記録を既定として使うため、
  プロジェクト側の更新は **`python tools/sync-harness.py [--apply]` の引数なし**で済む。
  /91 プロンプト・harness-sync スキルも「originを既定、確認だけ取る」に更新。
  これで「プロジェクトで『ハーネスを更新して』→ request-routing が /91 に振り分け →
  記録済みの本体から dry-run → 人間が --apply 1コマンド」の全自動運用が成立する。
- **決定3（未初期化検知の優先順位）**: intake-app.py / --init で
  作られたプロジェクトはハーネス由来の DECISIONS.md も持つため、D043 の
  「DECISIONS.md あり・progress.md なし = 本体」検知が**取り込み前のプロジェクトを
  本体と誤認する**（本体向けメッセージが出て /11 誘導もフェーズ外ガードも効かない）。
  判定を「intake-report.md があれば未初期化プロジェクト（/11 誘導）を最優先 →
  次に DECISIONS.md で本体」に修正した。適用先: request-routing スキル、
  フック4本（inject-progress.sh/.ps1・route-request.sh・guard-phase-scope.sh/.ps1）、
  selftest に回帰テスト3件を追加（計30件全PASS。2026-08-07 保守モードで適用完了）。
- **根拠**: 「コピーリストの完全性は目視でなく照合可能な正と突き合わせる」（D043追加4の
  教訓）を、突き合わせすら不要な「正が実行される」形に一段進めた。手動リストは
  写経のたびに劣化するが、マニフェスト駆動のツールは本体の進化に自動追従する。
  パス記憶は「ユーザーはコマンドも設定も覚えない」という D043 の受付ルーチン原則の
  適用範囲を、ハーネス自身の保守作業にまで広げたもの。

## D045: sync-harness.py の実行モード自動判定（指示の誤りを構造的に不可能にする）

- **出典**: ユーザー指摘（2026-08-07、D044 の直後）。エージェント（Claude Code 上の
  本体保守セッション）が、**ハーネス適用済み**のプロジェクトに対して `--init` 付きの
  コマンドを提示する誤指示をした。ツールの安全検査が中止して実害はなかったが、
  ユーザーから「間違った指示をしないようにハーネスで制御できるか」との要請。
- **問題の本質**: 「注入(--init)か更新(通常同期)か」の選択を呼び出し側（人・
  エージェントの指示）に委ねていた。対象の状態（progress.md の有無）から機械的に
  決まる事柄であり、指示層に判断を残せば誤りは必ず再発する。
- **決定**: `--project` 実行時のモードをツールが自動判定するようにした。
  適用済み（progress.md あり）→ 通常の逆同期（更新+欠けているファイルの追加）、
  未適用 → 初回注入（新規追加のみ・上書きなし）。判定結果は stdout とレポートに明示する。
  `--init` は「明示ヒント」に格下げし、**付けても付けなくても正しいモードで動く**
  （適用済み + --init はエラーではなく通常同期へ自動切替）。これにより
  導入・更新の指示は `python tools/sync-harness.py --project <対象> [--apply]` の
  **常に1つ**になり、USAGE.md・brownfield-intake スキルの案内も1コマンドに統一した。
- **根拠**: D043「指示よりHooks（機械的強制）」・D044「手動リストより実行される正」と
  同じ原理の適用。状態から機械的に導出できる判断を指示文に書くのは、写経のたびに
  劣化する手動コピーリストと同じ欠陥構造である。指示が間違いうる箇所は、
  指示を正すのではなく判断そのものをツールへ移す。
- **検証**: 未適用→自動注入 / 適用済み→自動同期 / 適用済み+誤`--init`→自動切替、の
  3シナリオを実測で確認（2026-08-07）。

## D046: 総点検2026-08の適用（ガード実穴修正・本体CI・done契約・Golden Eval ほか）

- **出典**: 総点検（2026-08-11〜12実施。D030以来2回目）。外部調査4系統
  （Claude Code公式 / Copilot公式 / コミュニティ動向 / 内部整合性監査）+
  ユーザー提供の参考資料3本（主要主張15件を一次情報で裏取り済み。Arizeの
  自己評価バイアス引用のみ「較正後は逆転」の重要な省略を検出）。レポートは
  `audits/retrospective-harness-audit-2026-08-11.md`（第1部: 優位点/P0-P3提案）と
  `audits/retrospective-harness-audit-2026-08-12.md`（第2部: ランタイム層/プロセス層の
  2層整理・外部100点法採点=現状64点・N系新提案）。ユーザーの明示指示のもと、
  保守モード（harness-maintenance --on）で優先順位どおり適用した。
- **適用1（P0: 機械ガードの実穴。内部監査で確定した迂回の修正）**:
  1. **PowerShellツール穴**: `.claude/settings.json` の PreToolUse コマンド系マッチャーを
     `Bash|PowerShell` に拡張し、`permissions.ask` に `PowerShell(git push:*)` 等の対を追加
     （この開発機で実際に PowerShell ツールが露出しており、`git push` やシークレットが
     guard/ask とも素通りしていた）。ファイル系マッチャーには `NotebookEdit` を追加し、
     guard-phase-scope と remind-record が `notebook_path` も読むようにした。
  2. **guard-dangerous-git の迂回**: `git -C <path> push`・`--git-dir=` 経由・
     `rm -fr`/`-r -f`/`--recursive --force`（順不同）を検知するようパターン拡張（sh/ps1両系）。
  3. **warn-stale-gate の主張と実装の乖離**: 監視対象を代表5ファイル→フェーズ配下の
     実体文書全体（nfr/environment/detailed-design/ADR/ICD等。テンプレート除く）に拡大。
  4. **guard-phase-scope の緩い除外**: 部分文字列一致（`app/src/tools/` がアプリコードなのに
     除外される）→ リポジトリルート相対の前方一致に厳密化。ルート外は対象外(allow)。
  5. **`.github/prompts/` を保護対象に追加**（deny + guard-harness-config-edit。
     プロンプトは正レイヤ=起動指示なのに無保護だった。harness-apply-retrospective の
     分類も更新）。
  6. **Stop/SessionEnd フックの `python` 直書き**: `run-python.sh` ラッパ経由に変更
     （素の Linux/macOS で計測・記録リマインドが無言全滅していた。python 優先で
     Store スタブ誤検出と remind-record の block 再実行を回避）。
  7. selftest.sh に上記の回帰ケースを追加し **44/44 PASS**（従来30ケース→44）。
     ps1 版も同一判定を実機確認。settings.json は保守モードの退避ファイル
     （.locked）と live の両方を strip_guards 互換の変換で同時更新し、--off 復元と
     整合させた。
- **適用2（P0-2: 本体CI）**: `.github/workflows/harness-ci.yml` を新設。push/PR で
  validate-harness.py・フックselftest・log-effort --selftest・golden-eval --selftest を
  実行する。「機械的強制を説くハーネス自身の整合性が手動検査頼み」という
  ドッグフーディング不在（内部監査G-1）の解消。
- **適用3（タスク単位の完了検証=done契約と3状態ループ制御。外部で最も一致度の
  高かった改善）**: tasks_template に「完了条件（検証コマンド+実行時確認）」を必須化し、
  implement は分解時に定義・呼び出し時に伝達、task-worker は完了条件を実行して
  **証拠つきで `[x]`** を付ける（満たせなければ失敗として返す）。失敗の扱いは
  **retry（同一戦略1回まで。同一失敗署名2回でスキップ）→ replan（仮説変更）→
  escalate（通算3回失敗で自動停止・人間へ）** の3状態に形式化し、gate-check に
  完了/エスカレーションの論理式と完了マークの規律を明文化した
  （根拠: Anthropic harness design 2026-03 の evaluator/sprint contract、
  Cherny「自己検証手段で品質2〜3倍」、Ralph系の circuit breaker 実務知）。
- **適用4（Golden Eval 最小版）**: `tools/golden-eval.py` を新設。KPI
  「完了宣言（GATE_STATUS done・tasks [x]）のうち機械的検証と整合する割合」を
  docs/ 構造から決定論的に測る（自己申告を信用しない検査。--selftest 付き、CIに組込）。
  ハーネス改善を主張ベースから測定ベースへ移す第一歩（内部監査G-2）。
- **適用5（鮮度更新）**: AGENTS.md のガードレール劣化モード節を2026-08の実状に更新
  （VS Code Copilot は UserPromptSubmit/Stop 含む8イベントをサポートし
  `.claude/settings.json` をネイティブ解釈=受付・記録の機械化が Copilot にも届く。
  **二重発火の実機確認は未了**として明記）。コスト節を AI Credits（トークン従量・
  可視化あり）へ更新し「Copilot はトークン非開示」の旧記述を訂正（D040 の劣化モード
  前提の変化）。README のフェーズ表に /91 を追加、ディレクトリツリーに tools/・
  DECISIONS.md・workflows/・06-retrospective を補記、「最終検証日」表記を導入。
  USAGE のセッション分割表に /11・/91 行と「40%で想起劣化」の根拠数値を追記。
  `infer:` 使用なし・廃止予定モデルへの pin なしを確認。
- **適用6（セキュリティ語彙・サプライチェーン・レビュワー懐疑化・引き算の点検）**:
  AGENTS.md に Lethal Trifecta / Rule of Two（(A)非信頼入力 (B)機密 (C)状態変更/外部送信の
  同時保有は2つまで）を接続追加時の判定基準として明文化。skill-authoring に外部Skill/
  プラグイン/MCPの統制手順（出所確認・版pin・導入前レビュー・最小権限・スキャン有効化。
  hackerbot-claw 実害事例が根拠）を追加。reviewer/spec-critic に懐疑チューニング
  （「合格をデフォルトにせず反証を試みる」）と2026年に語彙化した失敗モードの検査
  （落ちるテストの削除/skip化・失敗を隠すフォールバック・プレースホルダ実装・
  done契約証拠の照合）を追加。task-worker に search-before-assuming と対応する禁止事項。
  retrospective_template と harness-retrospective に「4.5 引き算の点検」
  （de-scaffolding: 不要になったガードを問う・learnings 棚卸しの毎回化）を追加。
- **見送り（理由つき。詳細は第2部レポート§4d）**: レビュワーの別ベンダーモデル必須化
  （Arize較正後データで根拠消滅。inherit=D040維持）、GATE_STATUS/tasks の全面JSON化
  （人間可読性優先。完了マーク改竄が実測されたら passes の JSON 分離へ昇格）、
  Graph Engineering（対象ファイル発見の失敗が実測されたら Aider 型=Context ランカーと
  して限定導入）、会話型マルチエージェント（D034維持。外部でも追認）、
  イベントストリーム/OTel/ACI の自前実装（ランタイム層の責務=プラットフォーム継承）。
  **P0-8（Copilot 二重発火）は実機検証待ち**のため設定変更せず注記のみ。
  P3群（prompts→skills 移行・constitution 分離・多言語化）は方針決定が必要なため未着手。
- **検証**: hooks selftest 44/44 PASS・validate-harness 0エラー0警告・
  log-effort selftest PASS・golden-eval selftest PASS・ps1 ガード実機確認。
- **適用手順**: 人間が `harness-maintenance.py --on --apply` で保守モード化してから実施。
  settings.json は退避ファイルと live を整合更新済みのため、**コミットは --off --apply で
  復元してから**行うこと（deny 空の状態をコミットしない）。

## D047: セッション境界の案内様式を固定（「再起動＋次の指示」の並記禁止）

- **出典**: ユーザー訂正（2026-08-12）。「ハーネス更新後に『セッションを再起動して
  ください』という文面とともに次の指示が続き、**再起動してから指示を継続するのか・
  このセッションで指示に従うのか毎回悩んでいた**。今回初めて指摘したが実は毎回
  発生していた（100%再現）。最低限この部分はどの環境でも発生しないようにする」。
- **問題の本質**: セッション境界をまたぐ案内で「今のセッションでやること」と
  「次のセッションでやること」の境界が明示されず、さらに反映タイミング
  （settings/hooks がいつ読み直されるか）が環境・実装依存で曖昧なため、
  エージェントの案内が条件分岐だらけになっていた。案内の曖昧さは指示の言い方の
  問題ではなく**様式が未定義**という構造の問題。
- **決定（固定様式・全環境共通）**: AGENTS.md ナビゲーション責務に追加。
  新しいチャット・再起動を案内するときは、必ず**応答の最後に1回だけ**次の2行で出す。
  1. 「このセッションの作業はここで完了です。」と言い切る（残作業は案内の前に終わらせる）
  2. 「次にやること: 新しいチャットを開き、最初に『<コピペ可能な1行>』と入力してください」
  案内の後ろに現在セッション向けの指示を続けることを禁止。設定変更後の続行は
  「今のチャットでも動くかもしれない」を案内に含めず**常に新しいチャット**に倒す。
- **併せて修正**: `tools/harness-maintenance.py` の --on/--off 完了メッセージが
  曖昧な「セッションを再起動してください」を出力していた（摩擦の発生源の一つ）ため、
  同じ固定様式（次にやること+理由1行）に書き換えた。
- **根拠**: D024（案内をコマンド形式に統一）・D043（案内の質は指示でなく構造で担保）と
  同じ原理。「どちらのセッションで実行するか」は様式で機械的に排除できる曖昧さであり、
  エージェントの気配りに任せる箇所ではない。
- **適用手順の注記**: AGENTS.md の編集は、保守モード中に開始したセッション
  （権限が旧状態のまま）から明示指示に基づき実施した。復元後の新セッションでは
  deny+フックが通常どおり効くことに変わりはない。
- **追記（同日・違反実例からの即時強化）**: この様式を適用した直後の完了宣言自体が、
  **push 未実施のまま「作業完了」と言い切る違反実例**になった（ユーザー指摘）。
  push は承認必須のため自動実行しない設計だが、だからこそ「完了」と言う前に
  push の承認を求めるべきだった。様式に「承認待ちの外部反映（push・タグ・デプロイ等）が
  残っている間は完了を宣言せず、先に承認を求める」を追加。完了宣言も done 契約と
  同じく証拠に束縛する。
