param(
    [switch]$Strict
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$warnRoots = @(
    "docs\plans",
    "docs\superpowers"
)

$findings = @()
foreach ($root in $warnRoots) {
    $full = Join-Path $ProjectRoot $root
    if (Test-Path $full) {
        $files = Get-ChildItem $full -Recurse -File -ErrorAction SilentlyContinue
        if ($files.Count -gt 0) {
            $findings += [pscustomobject]@{
                Root = $root
                Count = $files.Count
            }
        }
    }
}

if ($findings.Count -eq 0) {
    Write-Host "[DOCS-SCOPE] PASS no known temporary docs roots contain files"
    exit 0
}

foreach ($item in $findings) {
    Write-Warning "[DOCS-SCOPE] $($item.Root) contains $($item.Count) files; keep task-scoped artifacts in .planning/ when touched."
}

if ($Strict) {
    throw "Temporary docs roots still contain files."
}

Write-Host "[DOCS-SCOPE] WARN completed in non-strict mode"
