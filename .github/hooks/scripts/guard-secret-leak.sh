#!/usr/bin/env bash
# PreToolUse hook: ハードコードされた認証情報っぽい文字列の書き込みを検知する。
# 高確度パターン(クラウドの鍵形式・秘密鍵ヘッダ等)はdeny、
# 汎用パターン(api_key=... 等、誤検知しうる)はaskに留める。
input=$(cat)

# 判定ログ(ローカルのみ・gitignore対象)。ログ失敗はフック判定に影響させない。
# 注意: シークレット本文は絶対にログへ書かない(パターン種別のみ記録する)。
hook_log() {
  { d="$(dirname "$0")/../logs" && mkdir -p "$d" &&
    printf '%s\t%s\t%s\t%s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$(basename "$0")" "$1" "$2" >>"$d/hook-decisions.log"; } 2>/dev/null || true
}

high_confidence='AKIA[0-9A-Z]{16}|-----BEGIN( RSA| EC| OPENSSH)? PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}'
generic='(api[_-]?key|secret|token|password)\\?["'"'"']?\s*[:=]\s*\\?["'"'"'][A-Za-z0-9/+=_-]{16,}\\?["'"'"']'

if printf '%s' "$input" | grep -Eq "$high_confidence"; then
  hook_log deny "secret:high-confidence"
  printf '%s\n' '{"continue": true, "hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": "クラウド認証情報/秘密鍵とみられる文字列を検出しました。認証情報はコードやドキュメントに直接書かず、environment.mdに記載したシークレット管理先(GitHub Secrets等)を参照してください。"}}'
  exit 0
fi

if printf '%s' "$input" | grep -Eiq "$generic"; then
  hook_log ask "secret:generic"
  printf '%s\n' '{"continue": true, "systemMessage": "ハードコードされた認証情報らしき文字列を検出しました(誤検知の可能性もあります)。意図した内容か確認してください。", "hookSpecificOutput": {"permissionDecision": "ask", "permissionDecisionReason": "認証情報らしきパターンを検出したため確認します。"}}'
  exit 0
fi

printf '%s\n' '{"continue": true}'
