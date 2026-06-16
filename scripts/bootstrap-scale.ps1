param(
  [string]$Version = 'locked',
  [switch]$AutoInstall,
  [switch]$UseNpmMirror
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LockPath = Join-Path $ProjectRoot '.scale\governance.lock.json'
$PackageName = '@hongmaple0820/scale-engine'

function Get-LockedScaleVersion {
  if (-not (Test-Path $LockPath)) {
    return $null
  }
  try {
    $lock = Get-Content $LockPath -Raw | ConvertFrom-Json
    return [string]$lock.scaleVersion
  } catch {
    return $null
  }
}

function Get-InstalledScaleVersion {
  $cmd = Get-Command scale -ErrorAction SilentlyContinue
  if (-not $cmd) {
    return $null
  }
  try {
    $output = (& scale --version 2>$null | Select-Object -First 1)
    $version = ([string]$output).Trim()
    if ($version -notmatch '^(\d+\.\d+\.\d+|[0-9A-Za-z._-]+)$') {
      return $null
    }
    return $version
  } catch {
    return $null
  }
}

$lockedVersion = Get-LockedScaleVersion
$targetVersion = if ($Version -eq 'locked') { $lockedVersion } else { $Version }
if ([string]::IsNullOrWhiteSpace($targetVersion)) {
  $targetVersion = 'latest'
}

$installedVersion = Get-InstalledScaleVersion
$displayInstalled = if ($installedVersion) { $installedVersion } else { '<not installed>' }
$packageSpec = "$PackageName@$targetVersion"

Write-Host "[SCALE] installed: $displayInstalled"
Write-Host "[SCALE] target:    $targetVersion"

if ($targetVersion -ne 'latest' -and $installedVersion -eq $targetVersion) {
  Write-Host '[SCALE] OK'
  exit 0
}

if (-not $AutoInstall) {
  Write-Warning '[SCALE] scale-engine is missing or not aligned with target.'
  Write-Host 'To install the locked project version:'
  Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-scale.ps1 -AutoInstall'
  Write-Host 'To install the latest version:'
  Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-scale.ps1 -Version latest -AutoInstall'
  exit 2
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm was not found. Install Node.js/npm first.'
}

$npmArgs = @('install', '-g', $packageSpec)
if ($UseNpmMirror) {
  $npmArgs += @('--registry', 'https://registry.npmmirror.com')
}

Write-Host "[SCALE] installing: npm $($npmArgs -join ' ')"
& npm @npmArgs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$newVersion = Get-InstalledScaleVersion
Write-Host "[SCALE] installed now: $newVersion"
Write-Host '[SCALE] bootstrap completed'
