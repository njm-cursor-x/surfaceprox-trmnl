#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the Slate server on Windows (x64 or ARM64) as a startup task using Node.
  No Docker, no MSIX, no code signing.

.DESCRIPTION
  Run from a built checkout (pnpm install; pnpm build):
    powershell -ExecutionPolicy Bypass -File deploy\windows\install-server.ps1

  For most installs, use the one-liner in install.ps1 at the repo root instead (no Node needed).

  - Copies the runtime and node.exe to $InstallDir (default C:\Program Files\Slate)
  - Data (config.yml) lives in C:\ProgramData\slate
  - Both folders are writable by SYSTEM and Administrators only
  - Registers the "Slate Server" scheduled task: at startup, as SYSTEM, restart on failure
  - Allows inbound TCP $Port from the local subnet on the Private network profile only

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

function Set-AdminOnlyAcl([string]$Path) {
  # SYSTEM runs code from these folders, so standard users must not be able to write to them.
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  & icacls.exe $Path /setowner '*S-1-5-32-544' /T /C /Q | Out-Null
  & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T /C /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not lock down permissions on $Path" }
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Set-AdminOnlyAcl $InstallDir
Set-AdminOnlyAcl $DataDir
Write-Host "Staging runtime into $InstallDir"
& node (Join-Path $RepoRoot 'scripts\stage.mjs') $InstallDir
if ($LASTEXITCODE -ne 0) { throw 'Staging failed. Run "pnpm install" and "pnpm build" first.' }
# The node on PATH may live in a user-writable folder; SYSTEM runs a private copy instead.
$nodeExe = Join-Path $InstallDir 'node.exe'
Copy-Item -Force $node.Source $nodeExe
Set-AdminOnlyAcl $InstallDir

$entry = Join-Path $InstallDir 'apps\server\dist\slate.mjs'
$action = New-ScheduledTaskAction -Execute $nodeExe `
  -Argument "`"$entry`" serve --port $Port --data-dir `"$DataDir`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description 'Slate wall display server' -Force | Out-Null

Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port `
  -Profile Private -RemoteAddress LocalSubnet -Program $nodeExe -Action Allow | Out-Null

Start-ScheduledTask -TaskName $TaskName

$healthy = $false
foreach ($i in 1..30) {
  try {
    if ((Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/healthz" -TimeoutSec 2).StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $healthy) { throw "Slate did not answer on port $Port. Check Task Scheduler > '$TaskName' > History." }

Write-Host ''
Write-Host 'Slate is running. Finish setup in the browser (the wizard shows the kiosk command):'
& $nodeExe $entry setup-url --port $Port --data-dir $DataDir
Write-Host '(Phones need the Wi-Fi network set to Private in Windows settings.)'
