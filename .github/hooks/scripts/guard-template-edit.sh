#!/usr/bin/env bash
# PreToolUse hook: *_template.md への直接編集をブロックする。
# 想定外のペイロード形状でも安全側(継続許可)に倒す。
# パスの取り出しはJSON解析で行い、Windowsの \ 区切りを / に正規化してから照合する。
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
file=${file//\\//}
file=$(printf '%s' "$file" | sed -E 's|/{2,}|/|g')

# 判定ログ(ローカルのみ・gitignore対象)。ログ失敗はフック判定に影響させない。
hook_log() {
  { d="$(dirname "$0")/../logs" && mkdir -p "$d" &&
    printf '%s\t%s\t%s\t%s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$(basename "$0")" "$1" "$2" >>"$d/hook-decisions.log"; } 2>/dev/null || true
}

if [[ "$file" == *_template.md ]]; then
  hook_log deny "$file"
  printf '%s\n' '{"continue": true, "hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": "テンプレートファイルは直接編集せず、コピーして実体ファイル(例: requirements_template.md -> requirements.md)を作成してください。"}}'
else
  printf '%s\n' '{"continue": true}'
fi
