# .github/hooks/ について

VS Code の Agent Hooks（Preview機能）を使って、フェーズゲート運用を
「LLMの善意」ではなく機械的に補強するためのフック定義です。

## 含まれるフック

| ファイル | イベント | スクリプト | 動作 |
|---|---|---|---|
| `gate-hooks.json` | PreToolUse | `guard-template-edit.*` | `*_template.md` への直接編集を **deny**（コピーして実体ファイルを作るよう強制） |
| `gate-hooks.json` | PreToolUse | `guard-dangerous-git.*` | `git push` / `git tag` / `--force` / `reset --hard` / `rm -rf` を **ask**（毎回ユーザー確認）。`git -C <path> push` 等のグローバルオプション経由や `-fr`/`-r -f` のフラグ順不同も検知（D046） |
| `gate-hooks.json` | SessionStart | `inject-progress.*` | セッション開始時に `docs/00-overview/progress.md` のGATE_STATUSを自動でコンテキスト注入 |
| `gate-hooks.json` | PostToolUse | `warn-stale-gate.*` | 承認済み(done)のフェーズ配下の実体文書（requirements.md・nfr.md・detailed-design/・ADR等すべて。テンプレート除く）が編集されたら、後続フェーズとの整合確認を促す非ブロッキングの警告を出す（D046で代表5ファイル→フェーズ配下全体に拡大） |
| `gate-hooks.json` | PostToolUse | `check-doc-chars.*` | `docs/**.md` への書き込み後、不可視文字・文字化け（NUL / 本文中BOM / ハングル / 置換文字 / 生タブ / 全角空白 / BMP外漢字）を数え、0件でなければ**警告**する（編集ツールの混入事故対策。docsはlint対象外のため機械検査はここだけ。SessionStartの教訓注入は**新しい50件**+打ち切り明示） |
| `security-hooks.json` | PreToolUse | `guard-harness-config-edit.*` | `.github/agents/`, `.github/hooks/`, `.github/workflows/`, `.github/prompts/`, `AGENTS.md`, `CLAUDE.md`, `plugin.json`, `.vscode/settings.json`, アダプタ層への編集を **deny**（自己権限昇格・ガードレール解除の防止。`.github/skills/`は動的追加を許すため対象外。prompts は D046 で追加） |
| `security-hooks.json` | PreToolUse | `guard-secret-leak.*` | クラウド鍵/秘密鍵ヘッダ等の高確度パターンは **deny**、汎用的な `api_key=...` 等は **ask** |
| `gate-hooks.json` | PreCompact | `inject-progress.* PreCompact` | コンテキスト圧縮前にGATE_STATUS・教訓を再注入（圧縮でSessionStart注入分が失われる穴を塞ぐ） |
| `gate-hooks.json` | PreToolUse | `guard-phase-scope.*` | 進行中フェーズが無い状態（運用中・未初期化）でのアプリコード編集を **ask**（`/12-change-request` 等の入口を経てフェーズを `in_progress` にしてから作業する運用を機械的に担保。ハーネス管理領域 docs/ 等は対象外。緊急時は人が承認して続行可。D043） |
| （Claude Code専用: `.claude/settings.json`） | UserPromptSubmit | `route-request.sh` | ユーザーの依頼のたびにGATE_STATUS要約と受付ルーチンの契約（分類/入口/影響の冒頭宣言→入口コマンドの自己起動）を注入する（SessionStart 1回の注入は会話が伸びると薄まるため。D043。なお VS Code Copilot も現在は UserPromptSubmit/Stop をサポートし `.claude/settings.json` をネイティブ解釈するため届き得る=二重発火の実機確認は未了。D046） |
| （Claude Code専用: `.claude/settings.json`） | Stop | `remind-record.py` | アプリのコードを変更したのに docs/ に何も記録していない状態でターンを終えようとしたら**1回だけブロック**して記録（台帳/tasks/learnings）を促す（トランスクリプト解析でこのセッションの編集だけを見る。`stop_hook_active` でループ防止。自己テストは selftest.sh に含まれる。D043） |
| （Claude Code専用: `.claude/settings.json`） | Stop / SessionEnd | `log-effort.py` | セッションのトークン使用量を工程・エージェント・モデル・キャッシュ種別ごとに `docs/00-overview/effort-log.csv` へ upsert 記録する（`docs/00-overview/progress.md` があるプロジェクトのみ。非ブロッキング・失敗しても常に継続。集計は `python tools/effort-report.py`、自己テストは `python .github/hooks/scripts/log-effort.py --selftest`。D040）。Python 系フックは `run-python.sh` ラッパ経由で起動し、`python`/`python3` どちらしか無い環境でも動く（D046） |

**Claude Code 側の配線の補足（D046）**: `.claude/settings.json` の PreToolUse は
`Bash|PowerShell`（コマンド系）と `Edit|Write|MultiEdit|NotebookEdit`（ファイル系）を
マッチさせる。PowerShell ツール経由の `git push` 等が guard-dangerous-git・
`permissions.ask` の両方を素通りしていた穴を塞いだもの（ask には `PowerShell(git push:*)`
等の対も定義）。

## スクリプトの編集規則（事故防止）

- **`.ps1` はUTF-8 BOM付きが必須。** Windows PowerShell 5.1はBOMなしUTF-8の日本語を
  パースできず、フックが全滅する（派生ハーネスの初版で実際に発生した事故）。
  編集後の確認: `head -c 3 <file> | xxd` の出力が `efbbbf` であること。
- `.sh` はLF改行必須（`.gitattributes` で強制済み。CRLF化するとbashが実行できない）。
- **JSONペイロードを素朴な grep で読まない。** 値中のエスケープ済み引用符（`\"`）で
  抽出が切れ、危険判定に到達しないまま fail-open する（`cd "D:/…" && git push` が
  素通しになった実例あり）。`jq`/`node`/`python` によるJSON解析を主とし、grepは
  すべて無い環境のフォールバックに限る。パス照合は `\` 区切り（Windows）を `/` に
  正規化してから行う（`.ps1` 版は `[\\/]` 表記で両対応）。
- **フックスクリプトを変更したら `bash scripts/selftest.sh` を実行する。**
  フックは壊れていても静かに通る（fail-open）ため、「判定ログが空」なのが
  「発火する場面が無かった」のか「壊れている」のかは自己テストでしか切り分けられない
  （検知漏れ3件が2サイクル気づかれなかった実例あり）。

## 前提・注意点（正直な情報）

- Agent Hooksは執筆時点（2026年8月）で **Preview機能** であり、設定フォーマットや
  stdin/stdoutのペイロード形状は今後変わる可能性があります。
- スクリプトはペイロードのキー名を複数パターン（`file_path`/`filePath`/`path`、`command`等）で
  緩く探索し、**パース失敗時は安全側（`continue: true`、ブロックしない）に倒す**設計にしています。
  実際の挙動確認後、ペイロード形状に合わせて調整してください。
- 組織によっては `chat.useCustomAgentHooks` や関連設定が組織管理下で無効化されている場合があり、
  その場合フックは発火しません。フックが効かなくても、`AGENTS.md` の指示レベルのルールは
  引き続き有効です（二重の安全網という位置づけ）。
- Windowsでは `windows` フィールドのPowerShellスクリプトが、Git Bash/Linux/macでは
  `command`/`linux`/`osx` のbashスクリプトが使われます。

## 動作確認方法

`/hooks` をCopilot Chatで実行すると、GUIでフックの一覧・有効状態を確認できます。
