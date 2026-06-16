param(
    [string]$Path = "",
    [string]$ConfigSource = "TBD",
    [string]$Environment = "TBD",
    [string]$PrimaryCommand = "TBD",
    [string]$AuthMode = "TBD"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$StateFile = Join-Path $ProjectRoot ".agent\state\current.json"
$PyState = Join-Path $ProjectRoot "scripts\lib\workflow_state.py"

if ([string]::IsNullOrWhiteSpace($Path)) {
    if (-not (Test-Path $StateFile)) {
        throw "State file not found and -Path was not provided."
    }
    $relative = (& python $PyState get $StateFile runtime_contract "").Trim()
    if ([string]::IsNullOrWhiteSpace($relative)) {
        throw "Current workflow state does not define runtime_contract."
    }
    $Path = Join-Path $ProjectRoot $relative
}

$target = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
$planningRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath((Join-Path $ProjectRoot ".planning\tasks"))
$planningPrefix = $planningRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not ($target.Equals($planningRoot, [System.StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($planningPrefix, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Runtime contract path must stay under .planning\tasks: $target"
}

$dir = Split-Path $target -Parent
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$content = @"
# Runtime Contract

## Configuration Source

- Source: $ConfigSource
- Environment/profile: $Environment
- Local override file: TBD

## Service Topology

| Service | URL / Command | Config source | Auth mode | Status |
| --- | --- | --- | --- | --- |
| primary | $PrimaryCommand | $ConfigSource | $AuthMode | TBD |

## Verification Boundary

- Confirmed:
- Not covered:
- Requires external credentials:
- Requires shared/cloud environment:
"@

Set-Content -Path $target -Value $content -Encoding UTF8
Write-Host "[RUNTIME] wrote $target"
