param(
  [string]$Repo = "hongmaple0820/med-scale-research-os",
  [string]$SecretName = "NPM_TOKEN"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is not installed or not on PATH."
}

$authStatus = & gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "GitHub CLI is not logged in. Starting browser login..." -ForegroundColor Yellow
  & gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) {
    throw "gh auth login failed."
  }
}

$secureToken = Read-Host "Paste npm token for $SecretName (input hidden)" -AsSecureString
$plainToken = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
)

if ([string]::IsNullOrWhiteSpace($plainToken)) {
  throw "No token was provided."
}

try {
  $plainToken | & gh secret set $SecretName --repo $Repo --body-file -
  if ($LASTEXITCODE -ne 0) {
    throw "gh secret set failed."
  }
  Write-Host "Secret $SecretName has been set for $Repo." -ForegroundColor Green
} finally {
  $plainToken = $null
  $secureToken.Dispose()
}
