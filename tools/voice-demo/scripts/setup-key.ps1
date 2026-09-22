$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Zhiya Voice Demo - API Key Setup"

$secret = Read-Host "Enter DASHSCOPE_API_KEY (input is hidden)" -AsSecureString
$credential = [System.Management.Automation.PSCredential]::new("api", $secret)
$key = $credential.GetNetworkCredential().Password
if ([string]::IsNullOrWhiteSpace($key)) {
  throw "API Key cannot be empty"
}

$target = Join-Path (Split-Path $PSScriptRoot -Parent) ".env.local"
[System.IO.File]::WriteAllText(
  $target,
  "DASHSCOPE_API_KEY=$key`r`n",
  [System.Text.UTF8Encoding]::new($false)
)

Clear-Variable secret, credential, key
Write-Host "API Key saved to the ignored local config." -ForegroundColor Green
Start-Sleep -Seconds 3
