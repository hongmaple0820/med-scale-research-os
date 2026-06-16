param(
    [string]$Path = "",
    [switch]$Strict
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$StateFile = Join-Path $ProjectRoot ".agent\state\current.json"
$PyState = Join-Path $ProjectRoot "scripts\lib\workflow_state.py"

if ([string]::IsNullOrWhiteSpace($Path)) {
    if (-not (Test-Path $StateFile)) {
        throw "State file not found and -Path was not provided."
    }
    $relative = (& python $PyState get $StateFile reality_check "").Trim()
    if ([string]::IsNullOrWhiteSpace($relative)) {
        throw "Current workflow state does not define reality_check."
    }
    $Path = Join-Path $ProjectRoot $relative
}

$resolved = Resolve-Path $Path
$content = Get-Content $resolved -Raw
$required = @(
    "## Confirmed",
    "## Not Verified",
    "## Stub / Fake / Partial",
    "## Credential-Gated",
    "## Environment-Gated",
    "## User-Visible Risk"
)

$missing = @()
foreach ($heading in $required) {
    if ($content -notmatch [regex]::Escape($heading)) {
        $missing += $heading
    }
}

if ($missing.Count -gt 0) {
    throw "Reality check is missing required sections: $($missing -join ', ')"
}

if ($Strict -and $content -match "(?m)^-\s*TBD\s*$") {
    throw "Reality check still contains TBD placeholders."
}

Write-Host "[REALITY] PASS $resolved"
