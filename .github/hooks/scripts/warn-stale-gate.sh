#!/usr/bin/env bash
# PostToolUse hook: 承認済み(done)のフェーズ文書が編集されたら、後続フェーズとの
# 整合確認を促す非ブロッキングの警告を出す(手動編集自体は妨げない)。
# パスの取り出しはJSON解析で行い、Windowsの \ 区切りを / に正規化してから照合する
# (素朴なgrep抽出 + / 前提パターンでは \ 区切りパスに一致せず警告が出なかった)。
input=$(cat)

file=""
if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.filePath // .tool_input.path // empty' 2>/dev/null)
fi
if [[ -z "$file" ]] && command -v node >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | node -e 'try{const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const t=j.tool_input||{};process.stdout.write(String(t.file_path||t.filePath||t.path||""))}catch(e){}' 2>/dev/null)
fi
if [[ -z "$file" ]] && { command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; }; then
  py=$(command -v python3 2>/dev/null || command -v python)
  file=$(printf '%s' "$input" | "$py" -c 'import sys,json
try:
    t=json.load(sys.stdin).get("tool_input",{})
    print(t.get("file_path") or t.get("filePath") or t.get("path") or "",end="")
except Exception:
    pass' 2>/dev/null)
fi
if [[ -z "$file" ]]; then
  file=$(printf '%s' "$input" | grep -oE '"(file_path|filePath|path)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')
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

progress="docs/00-overview/progress.md"
if [[ -z "$file" || ! -f "$progress" ]]; then
  printf '%s\n' '{"continue": true}'
  exit 0
fi

# 対象はフェーズ配下の実体文書すべて(nfr/environment/detailed-design/ADR/ICD等を含む)。
# 従来は代表5ファイルのみで、AGENTS.mdの「承認済み文書の編集で警告」の主張より
# 実装が狭かった(D046。テンプレートは実体ではないため対象外)。
phase=""
case "$file" in
  *_template.md) : ;;
  *docs/01-requirements/*) phase="requirements" ;;
  *docs/02-design/*) phase="design" ;;
  *docs/03-implementation/*) phase="implementation" ;;
  *docs/04-test/*) phase="test" ;;
  *docs/05-release/*) phase="release" ;;
esac

if [[ -z "$phase" ]]; then
  printf '%s\n' '{"continue": true}'
  exit 0
fi

status=$(grep -E "^${phase}:" "$progress" | head -1 | sed -E "s/^${phase}:[[:space:]]*//")

if [[ "$status" == "done" ]]; then
  hook_log warn "$file"
  printf '{"continue": true, "systemMessage": "この文書(%s)は承認済み(done)ですが編集されました。後続フェーズとの整合を確認してください（必要ならdocs/00-overview/progress.mdのGATE_STATUSも見直してください）。"}\n' "$phase"
else
  printf '%s\n' '{"continue": true}'
fi
