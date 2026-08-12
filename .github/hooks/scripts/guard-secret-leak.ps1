# PreToolUse hook: ハードコードされた認証情報っぽい文字列の書き込みを検知する。
# 高確度パターン(クラウドの鍵形式・秘密鍵ヘッダ等)はdeny、
# 汎用パターン(api_key=... 等、誤検知しうる)はaskに留める。
$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()

# 判定ログ(ローカルのみ・gitignore対象)。ログ失敗はフック判定に影響させない。
# 注意: シークレット本文は絶対にログへ書かない(パターン種別のみ記録する)。
function Write-HookLog($decision, $target) {
  try {
    $dir = Join-Path $PSScriptRoot '..\logs'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $line = "{0}`t{1}`t{2}`t{3}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), (Split-Path $PSCommandPath -Leaf), $decision, $target
    Add-Content -Path (Join-Path $dir 'hook-decisions.log') -Value $line -Encoding UTF8
  } catch {}
}

$highConfidence = 'AKIA[0-9A-Z]{16}|-----BEGIN( RSA| EC| OPENSSH)? PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}'
$generic = '(api[_-]?key|secret|token|password)\\?[''"]?\s*[:=]\s*\\?[''"][A-Za-z0-9/+=_-]{16,}\\?[''"]'

if ($raw -match $highConfidence) {
  Write-HookLog 'deny' 'secret:high-confidence'
  $out = @{
    continue = $true
    hookSpecificOutput = @{
      permissionDecision = "deny"
      permissionDecisionReason = "クラウド認証情報/秘密鍵とみられる文字列を検出しました。認証情報はコードやドキュメントに直接書かず、environment.mdに記載したシークレット管理先(GitHub Secrets等)を参照してください。"
    }
  }
} elseif ($raw -match $generic) {
  Write-HookLog 'ask' 'secret:generic'
  $out = @{
    continue = $true
    systemMessage = "ハードコードされた認証情報らしき文字列を検出しました(誤検知の可能性もあります)。意図した内容か確認してください。"
    hookSpecificOutput = @{
      permissionDecision = "ask"
      permissionDecisionReason = "認証情報らしきパターンを検出したため確認します。"
    }
  }
} else {
  $out = @{ continue = $true }
}
$out | ConvertTo-Json -Depth 5 -Compress
