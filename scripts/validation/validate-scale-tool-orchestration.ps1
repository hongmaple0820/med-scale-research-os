param(
  [ValidateSet("quick", "full", "tooling", "ui", "workspace", "release")]
  [string]$Profile = "quick",

  [string]$ProjectDir = ".",

  [string]$TaskId = "tool-orchestration-review",

  [switch]$DryRun,

  [switch]$Json
)

$ErrorActionPreference = "Stop"

function Resolve-ProjectDir {
  param([string]$Path)
  return (Resolve-Path -LiteralPath $Path).Path
}

function New-Result {
  param(
    [string]$Name,
    [string]$Command,
    [string]$Status,
    [int]$ExitCode = 0,
    [string]$Message = ""
  )

  [pscustomobject]@{
    name = $Name
    command = $Command
    status = $Status
    exitCode = $ExitCode
    message = $Message
  }
}

function Invoke-ValidationCommand {
  param(
    [string]$Name,
    [string]$Command,
    [string]$WorkingDirectory
  )

  if ($DryRun) {
    return New-Result -Name $Name -Command $Command -Status "dry-run" -Message "Command was not executed."
  }

  Write-Host "[RUN] $Name" -ForegroundColor Cyan
  Write-Host "      $Command"

  Push-Location $WorkingDirectory
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -Command $Command
    $exit = $LASTEXITCODE
    if ($null -eq $exit) { $exit = 0 }

    if ($exit -ne 0) {
      return New-Result -Name $Name -Command $Command -Status "failed" -ExitCode $exit
    }

    return New-Result -Name $Name -Command $Command -Status "passed" -ExitCode 0
  }
  catch {
    return New-Result -Name $Name -Command $Command -Status "failed" -ExitCode 1 -Message $_.Exception.Message
  }
  finally {
    Pop-Location
  }
}

function Get-ValidationCommands {
  param([string]$Profile)

  $commands = New-Object System.Collections.Generic.List[object]

  $commands.Add([pscustomobject]@{
    name = "node version"
    command = "node --version"
  })
  $commands.Add([pscustomobject]@{
    name = "npm version"
    command = "npm --version"
  })
  $commands.Add([pscustomobject]@{
    name = "typescript build"
    command = "npm run build"
  })

  if ($Profile -in @("quick", "tooling", "ui", "workspace", "release")) {
    $commands.Add([pscustomobject]@{
      name = "targeted workflow tests"
      command = "npx vitest run tests/tools/toolPolicy.test.ts tests/tools/toolCapabilityRegistry.test.ts tests/tools/toolEvidenceStore.test.ts tests/tools/toolEvidenceGate.test.ts tests/tools/toolOrchestrator.test.ts tests/tools/toolCli.test.ts tests/skills/skillRouting.test.ts tests/workflow/phaseCli.test.ts tests/workflow/engineeringStandards.test.ts tests/workflow/resourceGovernance.test.ts tests/workflow/workspaceCli.test.ts"
    })
  }

  if ($Profile -eq "full" -or $Profile -eq "release") {
    $commands.Add([pscustomobject]@{
      name = "full test suite"
      command = "npx vitest run"
    })
  }

  if ($Profile -eq "tooling" -or $Profile -eq "release") {
    $commands.Add([pscustomobject]@{
      name = "scale doctor"
      command = "if (Test-Path dist/api/cli.js) { node dist/api/cli.js doctor --json } else { throw 'dist/api/cli.js missing; run npm run build first' }"
    })
    $commands.Add([pscustomobject]@{
      name = "scale skill doctor"
      command = "if (Test-Path dist/api/cli.js) { node dist/api/cli.js skill doctor --json } else { throw 'dist/api/cli.js missing; run npm run build first' }"
    })
  }

  if ($Profile -eq "ui") {
    $commands.Add([pscustomobject]@{
      name = "browser tooling availability"
      command = "if (Get-Command agent-browser -ErrorAction SilentlyContinue) { agent-browser doctor --json } else { Write-Warning 'agent-browser is not installed'; exit 0 }"
    })
    $commands.Add([pscustomobject]@{
      name = "playwright availability"
      command = "npx playwright --version"
    })
  }

  if ($Profile -eq "workspace" -or $Profile -eq "release") {
    $commands.Add([pscustomobject]@{
      name = "workspace finish summary"
      command = "if (Test-Path dist/api/cli.js) { node dist/api/cli.js workspace finish --summary } else { throw 'dist/api/cli.js missing; run npm run build first' }"
    })
  }

  $commands.Add([pscustomobject]@{
    name = "git whitespace check"
    command = "git diff --check"
  })

  return $commands
}

$root = Resolve-ProjectDir -Path $ProjectDir
$results = New-Object System.Collections.Generic.List[object]
$commands = Get-ValidationCommands -Profile $Profile

foreach ($entry in $commands) {
  $results.Add((Invoke-ValidationCommand -Name $entry.name -Command $entry.command -WorkingDirectory $root))
}

$failed = @($results | Where-Object { $_.status -eq "failed" })
$summary = [pscustomobject]@{
  taskId = $TaskId
  profile = $Profile
  projectDir = $root
  dryRun = [bool]$DryRun
  total = $results.Count
  failed = $failed.Count
  ok = ($failed.Count -eq 0)
  results = $results
}

if ($Json) {
  $summary | ConvertTo-Json -Depth 6
}
else {
  Write-Host ""
  Write-Host "SCALE tool orchestration validation summary"
  Write-Host "Profile: $Profile"
  Write-Host "Project: $root"
  Write-Host "DryRun: $DryRun"
  Write-Host "Total: $($summary.total), Failed: $($summary.failed)"

  foreach ($result in $results) {
    $color = if ($result.status -eq "passed") { "Green" } elseif ($result.status -eq "dry-run") { "Yellow" } else { "Red" }
    Write-Host ("[{0}] {1}" -f $result.status.ToUpperInvariant(), $result.name) -ForegroundColor $color
    if ($result.message) {
      Write-Host ("      {0}" -f $result.message)
    }
  }
}

if ($failed.Count -gt 0) {
  exit 1
}

exit 0
