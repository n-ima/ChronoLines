# PreToolUse hook: push/tag/force系のgit操作は毎回ユーザーに確認(ask)させる。
# denyではなくaskにしているのは、リリースフェーズなど正当なタイミングもあるため。
$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
$cmd = $null
try {
  $obj = $raw | ConvertFrom-Json
  $cmd = $obj.tool_input.command
} catch {
  if ($raw -match '"command"\s*:\s*"([^"]*)"') {
    $cmd = $Matches[1]
  }
}

# 判定ログ(ローカルのみ・gitignore対象)。ログ失敗はフック判定に影響させない。
function Write-HookLog($decision, $target) {
  try {
    $dir = Join-Path $PSScriptRoot '..\logs'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $line = "{0}`t{1}`t{2}`t{3}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), (Split-Path $PSCommandPath -Leaf), $decision, $target
    Add-Content -Path (Join-Path $dir 'hook-decisions.log') -Value $line -Encoding UTF8
  } catch {}
}

# git のグローバルオプション(-C/-c/--git-dir/--work-tree)を挟んだ push/tag、
# フラグ順不同の rm -rf も検知する(guard-dangerous-git.sh と同一判定。D046)
$gitOpt = '((-C|-c)\s+\S+|--(git-dir|work-tree)(=\S+|\s+\S+))'
$rmRf = 'rm\s+(-\w*(r\w*f|f\w*r)\w*|-\w*r\w*\s+-\w*f\w*|-\w*f\w*\s+-\w*r\w*|--recursive\s+--force|--force\s+--recursive)'
$dangerPattern = "git\s+($gitOpt\s+)*(push|tag)|reset\s+--hard|push\s+(-f|--force)|$rmRf"

if ($cmd -and ($cmd -match $dangerPattern)) {
  Write-HookLog 'ask' ($cmd.Substring(0, [Math]::Min(200, $cmd.Length)))
  $out = @{
    continue = $true
    systemMessage = "push/tag/force系またはrm -rfはAGENTS.mdの方針により都度確認が必要です。"
    hookSpecificOutput = @{
      permissionDecision = "ask"
      permissionDecisionReason = "外部/履歴に影響する可能性がある操作のため確認します。"
    }
  }
} else {
  $out = @{ continue = $true }
}
$out | ConvertTo-Json -Depth 5 -Compress
