# PostToolUse hook: 承認済み(done)のフェーズ文書が編集されたら、後続フェーズとの
# 整合確認を促す非ブロッキングの警告を出す(手動編集自体は妨げない)。
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

$progress = "docs/00-overview/progress.md"
if (-not $file -or -not (Test-Path $progress)) {
  @{ continue = $true } | ConvertTo-Json -Compress
  exit 0
}

# 対象はフェーズ配下の実体文書すべて(warn-stale-gate.sh と同一判定。D046)
$normalized = $file -replace '\\', '/'
$phase = $null
if ($normalized -notlike '*_template.md') {
  if ($normalized -like '*docs/01-requirements/*') { $phase = 'requirements' }
  elseif ($normalized -like '*docs/02-design/*') { $phase = 'design' }
  elseif ($normalized -like '*docs/03-implementation/*') { $phase = 'implementation' }
  elseif ($normalized -like '*docs/04-test/*') { $phase = 'test' }
  elseif ($normalized -like '*docs/05-release/*') { $phase = 'release' }
}

if (-not $phase) {
  @{ continue = $true } | ConvertTo-Json -Compress
  exit 0
}

$progressText = Get-Content -Raw $progress
$status = $null
if ($progressText -match "(?m)^$([regex]::Escape($phase)):\s*(\S+)") {
  $status = $Matches[1]
}

if ($status -eq "done") {
  Write-HookLog 'warn' $file
  $out = @{
    continue = $true
    systemMessage = "この文書($phase)は承認済み(done)ですが編集されました。後続フェーズとの整合を確認してください(必要ならdocs/00-overview/progress.mdのGATE_STATUSも見直してください)。"
  }
} else {
  $out = @{ continue = $true }
}
$out | ConvertTo-Json -Compress
