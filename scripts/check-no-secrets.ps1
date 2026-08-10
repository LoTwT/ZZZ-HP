#Requires -Version 5.1
<#
.SYNOPSIS
  Fail if admin plaintext passwords, DB dumps, or common secrets are present.

.EXAMPLE
  .\scripts\check-no-secrets.ps1
  Scan the repo working tree (skips node_modules / dist / .git / packages).

.EXAMPLE
  .\scripts\check-no-secrets.ps1 -Path .\packages\stage
  Scan a pack staging directory before zip.

.EXAMPLE
  .\scripts\check-no-secrets.ps1 -StagedOnly
  Scan only git staged files (for commit gate).
#>
[CmdletBinding()]
param(
  [string]$Path = '',
  [switch]$StagedOnly,
  [switch]$AllowDumpFiles
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

function Test-IsDumpFileName {
  param([string]$Name)
  return (
    $Name -ieq 'zzz_full_dump.sql' -or
    $Name -match '(?i)full[_-]?dump' -or
    ($Name -match '(?i)\.sql$' -and $Name -match '(?i)dump')
  )
}

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

$adminInsertPattern = 'INSERT\s+INTO\s+[`'']?admin[`'']?\s+VALUES\s*\(\s*\d+\s*,\s*''([^'']*)'''
$adminPasswordLinePattern = '(?m)^\s*ADMIN_PASSWORD\s*=\s*(.+)\s*$'

Write-Host ">> check-no-secrets  path=$Path  stagedOnly=$StagedOnly"

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
  # Dump files are always blocked even if gitignored.
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
  if (-not $AllowDumpFiles -and (Test-IsDumpFileName $name)) {
    Add-Finding "database dump file forbidden: $rel"
    continue
  }

  $ext = $file.Extension
  $scanText = $TextExt.Contains($ext) -or $name -ieq '.env.example' -or (Test-IsDumpFileName $name)
  if (-not $scanText) { continue }
  if ($file.Length -gt 20MB) { continue }

  $text = $null
  try {
    $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 -ErrorAction Stop
  }
  catch {
    continue
  }
  if (-not $text) { continue }

  $adminMatches = [regex]::Matches($text, $adminInsertPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  foreach ($m in $adminMatches) {
    $pwd = $m.Groups[1].Value
    if (-not (Test-IsBcryptOrPlaceholder $pwd)) {
      Add-Finding "plaintext admin password in $rel (value redacted in report)"
    }
  }

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
  Write-Host 'Rules: never commit/pack real DB dumps; admin password only via .env + set-admin-password.mjs (bcrypt in DB).' -ForegroundColor Yellow
  exit 1
}

Write-Host '>> check-no-secrets OK' -ForegroundColor Green
exit 0
