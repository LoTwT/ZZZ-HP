#Requires -Version 5.1
<#
.SYNOPSIS
  Fail if plaintext admin passwords or common credential files leak into commit/pack.

  Business DB data is allowed (character / w-engine / drive_disc / bangboo /
  boss / buff / boss_info / date / changelog / site_info_section, etc.).
  Only admin plaintext password is blocked.

.EXAMPLE
  .\scripts\check-no-secrets.ps1
.EXAMPLE
  .\scripts\check-no-secrets.ps1 -Path .\packages\stage
.EXAMPLE
  .\scripts\check-no-secrets.ps1 -StagedOnly
#>
[CmdletBinding()]
param(
  [string]$Path = '',
  [switch]$StagedOnly
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Path) { $Path = $RepoRoot }
$Path = (Resolve-Path -LiteralPath $Path).Path

$SkipDirNames = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@(
    'node_modules', '.git', 'dist', 'dist-ssr', 'coverage', 'packages',
    'guestbook_image', 'boss_image', 'buff_image', 'calculator_image',
    'uploads', 'character', 'wengine', 'drive_disc', 'bangboo',
    '.cursor', '.idea', '.vscode', '__screenshots__'
  ),
  [StringComparer]::OrdinalIgnoreCase
)

$TextExt = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@(
    '.sql', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.json', '.md',
    '.txt', '.env', '.yml', '.yaml', '.ps1', '.bat', '.cmd', '.sh', '.csv',
    '.html', '.css', '.example', '.toml', '.ini', '.conf'
  ),
  [StringComparer]::OrdinalIgnoreCase
)

function Test-IsBcryptOrPlaceholder {
  param([string]$Password)
  if ([string]::IsNullOrWhiteSpace($Password)) { return $true }
  if ($Password -eq 'REDACTED_ADMIN_PASSWORD') { return $true }
  if ($Password -eq 'CHANGE_ME') { return $true }
  if ($Password -match '^\$2[aby]\$') { return $true }
  return $false
}

$findings = New-Object System.Collections.Generic.List[string]

function Add-Finding {
  param([string]$Message)
  [void]$findings.Add($Message)
}

function Get-ScanFiles {
  if ($StagedOnly) {
    Push-Location $RepoRoot
    try {
      $names = & git diff --cached --name-only --diff-filter=ACMR
      if ($LASTEXITCODE -ne 0) { throw 'git diff --cached failed' }
      foreach ($rel in $names) {
        if (-not $rel) { continue }
        $full = Join-Path $RepoRoot $rel
        if (Test-Path -LiteralPath $full -PathType Leaf) {
          Get-Item -LiteralPath $full
        }
      }
    }
    finally {
      Pop-Location
    }
    return
  }

  Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object {
      $suffix = $_.FullName.Substring($Path.Length).TrimStart('\')
      $parts = $suffix.Split('\')
      if ($parts.Length -gt 1) {
        foreach ($p in $parts[0..($parts.Length - 2)]) {
          if ($SkipDirNames.Contains($p)) { return $false }
        }
      }
      return $true
    }
}

function Test-IsGitIgnored {
  param([string]$FullPath)
  if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot '.git'))) { return $false }
  Push-Location $RepoRoot
  try {
    & git check-ignore -q -- $FullPath 2>$null
    return ($LASTEXITCODE -eq 0)
  }
  finally {
    Pop-Location
  }
}

function Test-FileForPlainAdminPassword {
  param(
    [System.IO.FileInfo]$File,
    [string]$Rel
  )

  $linePattern = 'INSERT\s+INTO\s+[`'']?admin[`'']?\s+VALUES'
  $valuePattern = 'INSERT\s+INTO\s+[`'']?admin[`'']?\s+VALUES\s*\(\s*\d+\s*,\s*''([^'']*)'''

  $hits = Select-String -LiteralPath $File.FullName -Pattern $linePattern -AllMatches -ErrorAction SilentlyContinue
  foreach ($hit in $hits) {
    $m = [regex]::Match(
      $hit.Line,
      $valuePattern,
      [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($m.Success -and -not (Test-IsBcryptOrPlaceholder $m.Groups[1].Value)) {
      Add-Finding "plaintext admin password in $Rel (value redacted in report)"
    }
  }
}

$adminPasswordLinePattern = '(?m)^\s*ADMIN_PASSWORD\s*=\s*(.+)\s*$'

Write-Host ">> check-no-secrets  path=$Path  stagedOnly=$StagedOnly  (admin-password only)"

foreach ($file in Get-ScanFiles) {
  $name = $file.Name
  if ($file.FullName.StartsWith($Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    $rel = $file.FullName.Substring($Path.Length).TrimStart('\')
  }
  else {
    $rel = $file.FullName
  }

  $isEnvName = ($name -ieq '.env') -or ($name.StartsWith('.env.') -and $name -ine '.env.example')

  # Working tree: ignored local .env is OK. Staged .env still fails.
  if (-not $StagedOnly -and $isEnvName -and (Test-IsGitIgnored $file.FullName)) {
    continue
  }

  if ($isEnvName) {
    Add-Finding "secret env file: $rel"
    continue
  }
  if ($name -match '(?i)SecretKey' -or $name -match '(?i)\.(pem|key)$') {
    Add-Finding "credential/key file: $rel"
    continue
  }

  $ext = $file.Extension
  $scanText = $TextExt.Contains($ext) -or $name -ieq '.env.example'
  if (-not $scanText) { continue }

  # SQL dumps: only inspect admin INSERT lines (business tables are allowed)
  if ($ext -ieq '.sql') {
    Test-FileForPlainAdminPassword -File $file -Rel $rel
    continue
  }

  if ($file.Length -gt 8MB) { continue }

  $text = $null
  try {
    $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 -ErrorAction Stop
  }
  catch {
    continue
  }
  if (-not $text) { continue }

  Test-FileForPlainAdminPassword -File $file -Rel $rel

  if ($name -ine '.env.example') {
    $envMatches = [regex]::Matches($text, $adminPasswordLinePattern)
    foreach ($m in $envMatches) {
      $val = $m.Groups[1].Value.Trim().Trim('"').Trim("'")
      if ($val -and $val -notmatch '^(CHANGE_ME|your-|<.*>|xxx)$') {
        Add-Finding "ADMIN_PASSWORD assignment in $rel"
      }
    }
  }
}

if ($findings.Count -gt 0) {
  Write-Host ''
  Write-Host 'SECRET SCAN FAILED - refuse commit/pack until cleaned:' -ForegroundColor Red
  foreach ($f in $findings) {
    Write-Host "  - $f" -ForegroundColor Red
  }
  Write-Host ''
  Write-Host 'Rule: block plaintext admin password only. Calculator/crisis/defense/site SQL data is allowed.' -ForegroundColor Yellow
  Write-Host 'Admin password belongs in cloud .env + set-admin-password.mjs (bcrypt in DB).' -ForegroundColor Yellow
  exit 1
}

Write-Host '>> check-no-secrets OK' -ForegroundColor Green
exit 0
