param(
  [Parameter(Mandatory = $true)]
  [string]$Name,
  [ValidateSet('S', 'M', 'L', 'CRITICAL')]
  [string]$Level = 'M'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')

function Resolve-Bash {
  $candidates = @(
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files\Git\usr\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  $pathBash = Get-Command bash.exe -ErrorAction SilentlyContinue
  if ($pathBash -and $pathBash.Source -notlike '*\System32\bash.exe') {
    return $pathBash.Source
  }
  throw 'Git Bash was not found.'
}

$Bash = Resolve-Bash
Push-Location $Root
try {
  & $Bash 'scripts/workflow/new-task.sh' $Name $Level
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
