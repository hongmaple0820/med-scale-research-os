param(
    [string]$Task = "scale-engine workflow adaptation",
    [string]$Files = "AGENTS.md,README.md",
    [string]$Level = "M",
    [string]$Phase = "plan",
    [string]$Services = "",
    [string]$ScaleCommand = "scale"
)

$ErrorActionPreference = "Stop"

function Invoke-Scale {
    param([string[]]$ScaleArgs)

    Write-Host "[SCALE] $ScaleCommand $($ScaleArgs -join ' ')"
    & $ScaleCommand @ScaleArgs
    if ($LASTEXITCODE -ne 0) {
        throw "SCALE command failed: $ScaleCommand $($ScaleArgs -join ' ')"
    }
}

Invoke-Scale @("--version")
Invoke-Scale @("governance", "mode", "--task", $Task, "--files", $Files)
Invoke-Scale @("skill", "radar", "--dir", ".", "--task", $Task, "--phase", $Phase, "--level", $Level, "--files", $Files, "--services", $Services)
Invoke-Scale @("context", "budget", "--dir", ".")
Invoke-Scale @("codegraph", "status", "--dir", ".")
Invoke-Scale @("eval", "run", "--dir", ".")
Invoke-Scale @("artifact", "dashboard", "--dir", ".", "--lang", "zh")

Write-Host "[OK] SCALE smoke completed"
