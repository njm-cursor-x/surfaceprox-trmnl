#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the Slate server on Windows (x64 or ARM64) as a startup task using Node.
  No Docker, no MSIX, no code signing.

.DESCRIPTION
  Run from a built checkout (pnpm install; pnpm build):
    powershell -ExecutionPolicy Bypass -File deploy\windows\install-server.ps1

  - Copies the runtime to $InstallDir (default C:\Program Files\Slate)
  - Data (config.yml) lives in C:\ProgramData\slate
  - Registers the "Slate Server" scheduled task: at startup, as SYSTEM, restart on failure
  - Allows inbound TCP $Port on the Private network profile only (LAN config UI)

.PARAMETER Uninstall
  Removes the task, firewall rule, and install dir. Keeps C:\ProgramData\slate.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'Slate'),
  [int]$Port = 8787,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Slate Server'
$RuleName = "Slate (TCP $Port, Private)"
$DataDir = Join-Path $env:ProgramData 'slate'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

if ($Uninstall) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
  Write-Host "Slate removed. Your config is still in $DataDir."
  return
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'Node.js 22.13+ is required. Install it with: winget install OpenJS.NodeJS.LTS  (ships native ARM64 builds)'
}
$version = [version]((& node -p 'process.versions.node').Trim())
if ($version -lt [version]'22.13.0') { throw "Node $version is too old; install 22.13 or newer." }
$arch = (& node -p 'process.arch').Trim()
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -and $arch -ne 'arm64') {
  Write-Warning "This is an ARM64 PC but Node is $arch (emulated). Install the ARM64 Node build for better performance."
}

Write-Host "Staging runtime into $InstallDir"
& node (Join-Path $RepoRoot 'scripts\stage.mjs') $InstallDir
if ($LASTEXITCODE -ne 0) { throw 'Staging failed. Run "pnpm install" and "pnpm build" first.' }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$entry = Join-Path $InstallDir 'apps\server\dist\slate.mjs'
# SLATE_PORT has to reach the SYSTEM task, so wrap node in cmd to set it.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c set SLATE_PORT=$Port&& `"$($node.Source)`" `"$entry`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description 'Slate wall display server' -Force | Out-Null

if (-not (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port `
    -Profile Private -Action Allow | Out-Null
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName

$healthy = $false
foreach ($i in 1..30) {
  try {
    if ((Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/healthz" -TimeoutSec 2).StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $healthy) { throw "Slate did not answer on port $Port. Check Task Scheduler > '$TaskName' > History." }

$token = (Select-String -Path (Join-Path $DataDir 'config.yml') -Pattern '^\s+token:\s*(\S+)' | Select-Object -First 1).Matches.Groups[1].Value
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.PrefixOrigin -in 'Dhcp', 'Manual' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1).IPAddress

Write-Host ''
Write-Host 'Slate is running.'
Write-Host "  Config UI (this PC):   http://localhost:$Port"
if ($ip) { Write-Host "  Config UI (phone/LAN): http://${ip}:$Port   (Wi-Fi must be set to Private)" }
if ($token) {
  Write-Host "  Display URL:           http://localhost:$Port/d/$token"
  Write-Host ''
  Write-Host 'Next: set up the Edge kiosk:'
  Write-Host "  powershell -ExecutionPolicy Bypass -File deploy\windows\setup-kiosk.ps1 -Url http://localhost:$Port/d/$token"
}
