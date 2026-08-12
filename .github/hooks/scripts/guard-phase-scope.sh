#!/usr/bin/env bash
# PreToolUse hook: 進行中フェーズが無い状態(運用中・未初期化)でのアプリコード編集を ask で止める。
# 「入口(該当フェーズのコマンド)に入ってから作業する」を指示ではなく機械で担保する(D043決定5)。
# 正しく /12-change-request 等に入っていれば該当フェーズが in_progress になるため発火しない
# (ゲート状態を正直に保つ強制力を兼ねる)。deny ではなく ask なのは、緊急対応や例外を
# 人が1操作で通せるようにするため。ハーネス管理領域(docs/等)とリポジトリ外は対象外。
# 注意: Bash経由のファイル書き込み(echo > 等)はこのフックの対象外(既知の限界。AGENTS.md参照)。
input=$(cat)

file=""
if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.filePath // .tool_input.path // .tool_input.notebook_path // empty' 2>/dev/null)
fi
if [[ -z "$file" ]] && command -v node >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | node -e 'try{const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const t=j.tool_input||{};process.stdout.write(String(t.file_path||t.filePath||t.path||t.notebook_path||""))}catch(e){}' 2>/dev/null)
fi
if [[ -z "$file" ]] && { command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; }; then
  py=$(command -v python3 2>/dev/null || command -v python)
  file=$(printf '%s' "$input" | "$py" -c 'import sys,json
try:
    t=json.load(sys.stdin).get("tool_input",{})
    print(t.get("file_path") or t.get("filePath") or t.get("path") or t.get("notebook_path") or "",end="")
except Exception:
    pass' 2>/dev/null)
fi
if [[ -z "$file" ]]; then
  file=$(printf '%s' "$input" | grep -oE '"(file_path|filePath|path|notebook_path)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')
fi
# \ 区切り(Windows)を / に正規化。grepフォールバック経由のJSONエスケープ済み \\ が
# // になるため、連続する / は1つに畳む。
file=${file//\\//}
file=$(printf '%s' "$file" | sed -E 's|/{2,}|/|g')

# 判定ログ(ローカルのみ・gitignore対象)。ログ失敗はフック判定に影響させない。
hook_log() {
  { d="$(dirname "$0")/../logs" && mkdir -p "$d" &&
    printf '%s\t%s\t%s\t%s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$(basename "$0")" "$1" "$2" >>"$d/hook-decisions.log"; } 2>/dev/null || true
}

allow() { printf '%s\n' '{"continue": true}'; exit 0; }

# ファイルパスが取れない(Bashツール等) → 対象外
[[ -z "$file" ]] && allow

# リポジトリルート相対のパスに変換してから前方一致で除外を照合する
# (部分文字列一致では app/src/tools/x.ts 等のアプリコードが "tools/" に一致して
# 素通りしていた。D046)。ルート外(スクラッチパッド・~/.claude 等)はアプリコードでは
# ないため対象外(allow)。
pwdn=$PWD
command -v cygpath >/dev/null 2>&1 && pwdn=$(cygpath -m "$PWD" 2>/dev/null || printf '%s' "$PWD")
pwdn=${pwdn//\\//}
rel=""
shopt -s nocasematch
if [[ "$file" == "$pwdn"/* ]]; then
  rel=${file:$((${#pwdn}+1))}
elif [[ "$file" != /* && "$file" != [A-Za-z]:* ]]; then
  rel=$file  # 相対パスはルート相対とみなす
else
  shopt -u nocasematch
  allow  # リポジトリ外
fi
case "$rel" in
  docs/*|requirements/*|.github/*|.claude/*|.agents/*|tools/*|.vscode/*|\
  README.md|.gitignore|.gitattributes|DECISIONS.md|MEMORY.md)
    shopt -u nocasematch
    allow ;;
esac
shopt -u nocasematch

progress="docs/00-overview/progress.md"

if [[ ! -f "$progress" ]]; then
  # 取り込み済み・/11未完了のプロジェクトは「未初期化」として扱う。intake由来の
  # DECISIONS.md を持つため、本体検知より先に判定する(D044)
  if [[ ! -f "docs/00-overview/intake-report.md" ]]; then
    # ハーネス本体リポジトリ(DECISIONS.mdあり・progress.mdなし)では発火させない
    [[ -f "DECISIONS.md" ]] && allow
  fi
  hook_log ask "$file (uninitialized)"
  printf '%s\n' '{"continue": true, "hookSpecificOutput": {"permissionDecision": "ask", "permissionDecisionReason": "プロジェクトが未初期化です(progress.md なし)。コードに触る前に、新規開発なら /00-start-project、既存アプリの取り込みなら /11-brownfield-intake を実行してください(取り込み前のアプリ改変は brownfield-intake のアンチパターン)。緊急の場合はこの確認を承認して続行できます。"}}'
  exit 0
fi

# いずれかのフェーズが進行中(in_progress/pending_approval)なら通常のフェーズ作業 → 許可
if awk '/<!-- GATE_STATUS/,/-->/' "$progress" | grep -Eq '^(requirements|design|implementation|test|release):[[:space:]]*(in_progress|pending_approval)'; then
  allow
fi

hook_log ask "$file (no active phase)"
printf '%s\n' '{"continue": true, "hookSpecificOutput": {"permissionDecision": "ask", "permissionDecisionReason": "進行中のフェーズがありません(GATE_STATUSに in_progress がない=運用中または未着手)。アプリコードの変更は /12-change-request(運用中の変更請求)または該当フェーズのコマンドを経由し、フェーズを in_progress にしてから行ってください。緊急ホットフィックスの場合はこの確認を承認して続行できます(その場合も再現テスト・記録は省略しない)。"}}'
