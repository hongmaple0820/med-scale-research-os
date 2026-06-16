param(
  [string]$Profile = 'default',
  [string]$Service = '',
  [switch]$List
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

  throw 'Git Bash was not found. Install Git for Windows or run scripts/workflow/verify.sh from a POSIX shell.'
}

$Bash = Resolve-Bash
Push-Location $Root
try {
  $args = @('scripts/workflow/verify.sh', '--profile', $Profile)
  if ($Service) {
    $args += @('--service', $Service)
  }
  if ($List) {
    $args += '--list'
  }
  & $Bash @args
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
