# PreToolUse hook: ハーネス自体の運用ルール(エージェント定義/フック/AGENTS.md等)への
# 無断編集をdenyする。プロンプトインジェクションによる自己権限昇格・ガードレール解除を防ぐ。
# 注意: .github/skills/ は動的なSkill追加を許容するため対象外にしている。
$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
$file = $null
try {
  $obj = $raw | ConvertFrom-Json
  $file = $obj.tool_input.file_path
  if (-not $file) { $file = $obj.tool_input.filePath }
  if (-not $file) { $file = $obj.tool_input.path }
} catch {
  if ($raw -match '"(file_path|filePath|path)"\s*:\s*"([^"]*)"') {
    $file = $Matches[2]
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

# .github/prompts/ も正レイヤ(起動指示)のため保護対象(D046)
$protectedPattern = '(^|[\\/])\.github[\\/]agents[\\/]|(^|[\\/])\.github[\\/]hooks[\\/]|(^|[\\/])\.github[\\/]workflows[\\/]|(^|[\\/])\.github[\\/]prompts[\\/]|(^|[\\/])AGENTS\.md$|(^|[\\/])CLAUDE\.md$|(^|[\\/])plugin\.json$|(^|[\\/])\.vscode[\\/]settings\.json$|(^|[\\/])\.claude[\\/]settings\.json$|(^|[\\/])\.claude[\\/]agents[\\/]|(^|[\\/])\.claude[\\/]commands[\\/]|(^|[\\/])\.agents[\\/]workflows[\\/]'

if ($file -and ($file -match $protectedPattern)) {
  Write-HookLog 'deny' $file
  $out = @{
    continue = $true
    hookSpecificOutput = @{
      permissionDecision = "deny"
      permissionDecisionReason = "ハーネスの運用ルール自体(agents/hooks/workflows/prompts/commands/AGENTS.md/CLAUDE.md/plugin.json/settings.json)はエージェントが自動で書き換えません。変更が必要な場合は人間が直接編集するか、明示的な指示のもとで行ってください。"
    }
  }
} else {
  $out = @{ continue = $true }
}
$out | ConvertTo-Json -Depth 5 -Compress
