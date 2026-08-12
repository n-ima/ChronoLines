#!/usr/bin/env bash
# PreToolUse hook: ハーネス自体の運用ルール(エージェント定義/フック/AGENTS.md等)への
# 無断編集をdenyする。プロンプトインジェクションによる自己権限昇格・ガードレール解除を防ぐ。
# 注意: .github/skills/ は動的なSkill追加を許容するため対象外にしている。
# パスの取り出しはJSON解析で行い、Windowsの \ 区切りを / に正規化してから照合する
# (素朴なgrep抽出 + / 前提パターンでは \ 区切りパスに一致せず fail-open していた)。
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

# .github/prompts/ も正レイヤ(起動指示)のため保護対象(D046。スキルのみ動的追加のため対象外)
protected_pattern='(^|/)\.github/agents/|(^|/)\.github/hooks/|(^|/)\.github/workflows/|(^|/)\.github/prompts/|(^|/)AGENTS\.md$|(^|/)CLAUDE\.md$|(^|/)plugin\.json$|(^|/)\.vscode/settings\.json$|(^|/)\.claude/settings\.json$|(^|/)\.claude/agents/|(^|/)\.claude/commands/|(^|/)\.agents/workflows/'

if [[ -n "$file" ]] && printf '%s' "$file" | grep -Eiq "$protected_pattern"; then
  hook_log deny "$file"
  printf '%s\n' '{"continue": true, "hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": "ハーネスの運用ルール自体(agents/hooks/workflows/prompts/commands/AGENTS.md/CLAUDE.md/plugin.json/settings.json)はエージェントが自動で書き換えません。変更が必要な場合は人間が直接編集するか、明示的な指示のもとで行ってください。"}}'
else
  printf '%s\n' '{"continue": true}'
fi
