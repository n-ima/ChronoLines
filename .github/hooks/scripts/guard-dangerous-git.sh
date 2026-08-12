#!/usr/bin/env bash
# PreToolUse hook: push/tag/force系のgit操作は毎回ユーザーに確認(ask)させる。
# denyではなくaskにしているのは、リリースフェーズなど正当なタイミングもあるため。
# commandの取り出しはJSON解析で行う(素朴なgrep抽出は値中のエスケープ済み引用符 \" で
# 切れて危険判定に到達しないまま fail-open する。実例: cd "D:/…" && git push が素通し)。
input=$(cat)

cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
fi
if [[ -z "$cmd" ]] && command -v node >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | node -e 'try{const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String((j.tool_input&&j.tool_input.command)||""))}catch(e){}' 2>/dev/null)
fi
if [[ -z "$cmd" ]] && { command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; }; then
  py=$(command -v python3 2>/dev/null || command -v python)
  cmd=$(printf '%s' "$input" | "$py" -c 'import sys,json
try:
    print(json.load(sys.stdin).get("tool_input",{}).get("command","") or "",end="")
except Exception:
    pass' 2>/dev/null)
fi
# jq/node/python がすべて無い・すべて失敗した環境だけ従来のgrep抽出にフォールバック
if [[ -z "$cmd" ]]; then
  cmd=$(printf '%s' "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')
fi

# 判定ログ(ローカルのみ・gitignore対象)。ログ失敗はフック判定に影響させない。
hook_log() {
  { d="$(dirname "$0")/../logs" && mkdir -p "$d" &&
    printf '%s\t%s\t%s\t%s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$(basename "$0")" "$1" "$2" >>"$d/hook-decisions.log"; } 2>/dev/null || true
}

# git のグローバルオプション(-C <path> / -c <k=v> / --git-dir / --work-tree)を挟んだ
# push/tag も検知する(`git -C repo push` で素通しだった迂回の修正。D046)。
# rm はフラグの順序・分割(-rf/-fr/-r -f/-f -r/--recursive --force)に依らず検知する。
git_opt='((-C|-c)[[:space:]]+[^[:space:]]+|--(git-dir|work-tree)(=[^[:space:]]+|[[:space:]]+[^[:space:]]+))'
rm_rf='rm[[:space:]]+(-[[:alnum:]]*(r[[:alnum:]]*f|f[[:alnum:]]*r)[[:alnum:]]*|-[[:alnum:]]*r[[:alnum:]]*[[:space:]]+-[[:alnum:]]*f[[:alnum:]]*|-[[:alnum:]]*f[[:alnum:]]*[[:space:]]+-[[:alnum:]]*r[[:alnum:]]*|--recursive[[:space:]]+--force|--force[[:space:]]+--recursive)'
danger_pattern="git[[:space:]]+(${git_opt}[[:space:]]+)*(push|tag)|reset[[:space:]]+--hard|push[[:space:]]+(-f|--force)|${rm_rf}"

if printf '%s' "$cmd" | grep -Eiq "$danger_pattern"; then
  hook_log ask "${cmd:0:200}"
  printf '%s\n' '{"continue": true, "systemMessage": "push/tag/force系またはrm -rfはAGENTS.mdの方針により都度確認が必要です。", "hookSpecificOutput": {"permissionDecision": "ask", "permissionDecisionReason": "外部/履歴に影響する可能性がある操作のため確認します。"}}'
else
  printf '%s\n' '{"continue": true}'
fi
