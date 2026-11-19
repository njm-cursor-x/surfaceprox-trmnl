<#
.SYNOPSIS
  One-line Slate install for Windows 11 (x64 or ARM64):
    irm https://raw.githubusercontent.com/njm-cursor-x/surfaceprox-trmnl/main/install.ps1 | iex

.DESCRIPTION
  Downloads the standalone slate.exe for this PC's architecture, checks its SHA-256,
  installs it to C:\Program Files\Slate, and runs it at startup as SYSTEM. Then opens the
  setup wizard. No Node, Docker, or code signing needed.

  Optional environment variables (they also work through `irm | iex`):
    SLATE_VERSION   release tag to install (default: latest)
    SLATE_PORT      port (default 8787)
    SLATE_BINARY    path to a local slate-win-<arch>.exe instead of downloading
    SLATE_NO_BROWSER=1  don't open the setup page
    SLATE_UNINSTALL=1   remove the task, firewall rule, and program files (keeps your data)
#>
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'njm-cursor-x/surfaceprox-trmnl'
$Port = if ($env:SLATE_PORT) { [int]$env:SLATE_PORT } else { 8787 }
$InstallDir = Join-Path $env:ProgramFiles 'Slate'
$DataDir = Join-Path $env:ProgramData 'slate'
$Exe = Join-Path $InstallDir 'slate.exe'
$TaskName = 'Slate Server'
$RuleName = "Slate (TCP $Port, Private)"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  # `irm | iex` has no script file to re-launch, so fetch one and run it elevated.
  $self = Join-Path $env:TEMP 'slate-install.ps1'
  if ($PSCommandPath) { Copy-Item $PSCommandPath $self -Force }
  else { Invoke-RestMethod "https://raw.githubusercontent.com/$Repo/main/install.ps1" -OutFile $self }
  Write-Host 'Slate needs administrator rights to install a startup task. Approve the prompt.'
  $vars = 'SLATE_VERSION', 'SLATE_PORT', 'SLATE_BINARY', 'SLATE_NO_BROWSER', 'SLATE_UNINSTALL' |
    Where-Object { [Environment]::GetEnvironmentVariable($_) } |
    ForEach-Object { "`$env:$_='$([Environment]::GetEnvironmentVariable($_).Replace("'", "''"))';" }
  $cmd = "$($vars -join ' ') & '$($self.Replace("'", "''"))'"
  Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd
  return
}

function Set-AdminOnlyAcl([string]$Path) {
  # SYSTEM runs slate.exe and the plugins it unpacks here, so standard users must not be
  # able to write (or plant files) anywhere under these folders.
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  & icacls.exe $Path /setowner '*S-1-5-32-544' /T /C /Q | Out-Null
  & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T /C /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not lock down permissions on $Path" }
}

if ($env:SLATE_UNINSTALL -eq '1') {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
  Write-Host "Slate removed. Your settings are still in $DataDir."
  return
}

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
$asset = "slate-win-$arch.exe"

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Set-AdminOnlyAcl $InstallDir
Set-AdminOnlyAcl $DataDir
# Unpacked runtime files predate the ACL lock; let slate.exe unpack them again.
Remove-Item -Recurse -Force (Join-Path $DataDir 'runtime') -ErrorAction SilentlyContinue

if ($env:SLATE_BINARY) {
  Write-Host "Installing $env:SLATE_BINARY"
  Copy-Item -Force $env:SLATE_BINARY $Exe
} else {
  $base = if ($env:SLATE_VERSION) { "https://github.com/$Repo/releases/download/$env:SLATE_VERSION" }
          else { "https://github.com/$Repo/releases/latest/download" }
  $tmp = Join-Path $InstallDir "$asset.download"
  Write-Host "Downloading $asset"
  Invoke-WebRequest -UseBasicParsing "$base/$asset" -OutFile $tmp
  $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHA256SUMS").Content -split "`n"
  $expected = ($sums | Where-Object { $_ -match "\s\*?$([regex]::Escape($asset))\s*$" } | Select-Object -First 1) -replace '\s.*$', ''
  $actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash
  if (-not $expected -or $actual -ne $expected.ToUpper()) {
    Remove-Item -Force $tmp
    throw "Checksum mismatch for $asset; not installing."
  }
  Move-Item -Force $tmp $Exe
}

$action = New-ScheduledTaskAction -Execute $Exe -Argument "serve --port $Port --data-dir `"$DataDir`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description 'Slate wall display server' -Force | Out-Null

Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port `
  -Profile Private -RemoteAddress LocalSubnet -Program $Exe -Action Allow | Out-Null

Start-ScheduledTask -TaskName $TaskName
# The server listens on IPv4; "localhost" can resolve to ::1 first and time out.
$healthy = $false
foreach ($i in 1..60) {
  try {
    if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/healthz" -TimeoutSec 2).StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $healthy) {
  $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  Write-Host "Task state: $((Get-ScheduledTask -TaskName $TaskName).State); last result: $($info.LastTaskResult)"
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $log = Join-Path $env:TEMP 'slate-install-check.log'
  $p = Start-Process -FilePath $Exe -ArgumentList 'serve', '--port', $Port, '--data-dir', "`"$DataDir`"" `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -NoNewWindow
  Start-Sleep -Seconds 10
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  Get-Content $log, "$log.err" -ErrorAction SilentlyContinue | Write-Host
  throw "Slate did not answer on port $Port. Check Task Scheduler > '$TaskName' > History."
}

Write-Host ''
Write-Host 'Slate is running.'
& $Exe setup-url --qr --port $Port --data-dir $DataDir
Write-Host '(Phones need the Wi-Fi network set to Private in Windows settings.)'
if ($env:SLATE_NO_BROWSER -ne '1') { Start-Process "http://127.0.0.1:$Port/setup" }
