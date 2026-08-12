# PreToolUse hook: 進行中フェーズが無い状態(運用中・未初期化)でのアプリコード編集を ask で止める。
# guard-phase-scope.sh と同じ判定(Copilot Windows用)。想定外のペイロードは安全側(継続許可)に倒す。
$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
$file = $null
try {
  $obj = $raw | ConvertFrom-Json
  $file = $obj.tool_input.file_path
  if (-not $file) { $file = $obj.tool_input.filePath }
  if (-not $file) { $file = $obj.tool_input.path }
  if (-not $file) { $file = $obj.tool_input.notebook_path }
} catch {
  if ($raw -match '"(file_path|filePath|path|notebook_path)"\s*:\s*"([^"]*)"') {
    $file = $Matches[2]
  }
}

function Write-HookLog($decision, $target) {
  try {
    $dir = Join-Path $PSScriptRoot '..\logs'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $line = "{0}`t{1}`t{2}`t{3}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), (Split-Path $PSCommandPath -Leaf), $decision, $target
    Add-Content -Path (Join-Path $dir 'hook-decisions.log') -Value $line -Encoding UTF8
  } catch {}
}

function Out-Allow {
  (@{ continue = $true } | ConvertTo-Json -Depth 5 -Compress)
  exit 0
}

if (-not $file) { Out-Allow }
$norm = ($file -replace '\\', '/') -replace '/{2,}', '/'

# リポジトリルート相対に変換してから前方一致で除外を照合(guard-phase-scope.sh と同一判定。
# D046)。ルート外(スクラッチパッド等)はアプリコードではないため対象外(allow)。
$pwdn = (Get-Location).Path -replace '\\', '/'
$rel = $null
if ($norm.StartsWith("$pwdn/", [System.StringComparison]::OrdinalIgnoreCase)) {
  $rel = $norm.Substring($pwdn.Length + 1)
} elseif ($norm -notmatch '^([A-Za-z]:)?/') {
  $rel = $norm  # 相対パスはルート相対とみなす
} else {
  Out-Allow  # リポジトリ外
}
$allowPatterns = @(
  'docs/*', 'requirements/*', '.github/*', '.claude/*', '.agents/*',
  'tools/*', '.vscode/*', 'README.md', '.gitignore', '.gitattributes',
  'DECISIONS.md', 'MEMORY.md'
)
foreach ($p in $allowPatterns) {
  if ($rel -like $p) { Out-Allow }
}

$progress = "docs/00-overview/progress.md"

if (-not (Test-Path $progress)) {
  # 取り込み済み・/11未完了のプロジェクトは「未初期化」として扱う。intake由来の
  # DECISIONS.md を持つため、本体検知より先に判定する(D044)
  if (-not (Test-Path "docs/00-overview/intake-report.md")) {
    if (Test-Path "DECISIONS.md") { Out-Allow }  # ハーネス本体リポジトリでは発火させない
  }
  Write-HookLog 'ask' "$norm (uninitialized)"
  $out = @{
    continue = $true
    hookSpecificOutput = @{
      permissionDecision = "ask"
      permissionDecisionReason = "プロジェクトが未初期化です(progress.md なし)。コードに触る前に、新規開発なら /00-start-project、既存アプリの取り込みなら /11-brownfield-intake を実行してください(取り込み前のアプリ改変は brownfield-intake のアンチパターン)。緊急の場合はこの確認を承認して続行できます。"
    }
  }
  $out | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

$content = Get-Content $progress -Raw
$match = [regex]::Match($content, '(?s)<!-- GATE_STATUS.*?-->')
$block = if ($match.Success) { $match.Value } else { "" }
if ($block -match '(?m)^(requirements|design|implementation|test|release):\s*(in_progress|pending_approval)') {
  Out-Allow  # 進行中フェーズあり=通常のフェーズ作業
}

Write-HookLog 'ask' "$norm (no active phase)"
$out = @{
  continue = $true
  hookSpecificOutput = @{
    permissionDecision = "ask"
    permissionDecisionReason = "進行中のフェーズがありません(GATE_STATUSに in_progress がない=運用中または未着手)。アプリコードの変更は /12-change-request(運用中の変更請求)または該当フェーズのコマンドを経由し、フェーズを in_progress にしてから行ってください。緊急ホットフィックスの場合はこの確認を承認して続行できます(その場合も再現テスト・記録は省略しない)。"
  }
}
$out | ConvertTo-Json -Depth 5 -Compress
