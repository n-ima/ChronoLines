# PostToolUse hook: docs/ 配下の .md への書き込み後に、編集ツールが混入させがちな
# 不可視文字・文字化け(NUL / 本文中BOM / ハングル / 置換文字 / 生タブ / 全角空白 /
# BMP外漢字)を数え、0件でなければ非ブロッキングの警告を出す。
# 注意: 検査対象の文字をこのスクリプト自身に混入させないため、パターンは
# [char]0xXXXX から組み立てる(リテラルでもバックスラッシュu表記でも書かない。
# windows-shell-conventions §5 のバックスラッシュ表記破壊対策)。
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
if ($file) {
  $file = $file -replace '\\', '/'
  $file = $file -replace '/{2,}', '/'
}

if (-not $file -or $file -notmatch 'docs/.*\.md$' -or -not (Test-Path $file)) {
  @{ continue = $true } | ConvertTo-Json -Compress
  exit 0
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

# ReadAllText は先頭BOMを除去して読むため、テキスト中に U+FEFF が残っていれば本文中のもの
$text = [System.IO.File]::ReadAllText($file)
$hits = @()
$checks = @(
  @{ n = 'NUL';               p = [string][char]0x0000 },
  @{ n = 'hombunBOM';         p = [string][char]0xFEFF },
  @{ n = 'hanguru';           p = ('[' + [char]0x1100 + '-' + [char]0x11FF + [char]0xAC00 + '-' + [char]0xD7AF + ']') },
  @{ n = 'chikanmoji-U+FFFD'; p = [string][char]0xFFFD },
  @{ n = 'nama-tab';          p = "`t" },
  @{ n = 'zenkaku-kuhaku';    p = [string][char]0x3000 },
  @{ n = 'BMP-gai-kanji';     p = ('[' + [char]0xD840 + '-' + [char]0xD87F + '][' + [char]0xDC00 + '-' + [char]0xDFFF + ']') }
)
foreach ($c in $checks) {
  $m = [regex]::Matches($text, $c.p)
  if ($m.Count -gt 0) { $hits += ("{0}:{1}" -f $c.n, $m.Count) }
}

if ($hits.Count -gt 0) {
  Write-HookLog 'warn' ("{0} {1}" -f $file, ($hits -join ' '))
  $out = @{
    continue = $true
    systemMessage = "docs への書き込みに不可視文字/文字化けの疑いがあります($file): $($hits -join ' ')。意図した文字か確認し、混入なら除去してください(NUL=ヌル文字, hombunBOM=本文中BOM, hanguru=ハングル, nama-tab=タブ, zenkaku-kuhaku=全角空白)。"
  }
} else {
  $out = @{ continue = $true }
}
$out | ConvertTo-Json -Depth 5 -Compress
