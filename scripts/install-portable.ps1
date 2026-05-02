[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\PlanUsageMeter'),
  [switch]$NoLaunch,
  [switch]$StartupShortcut
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir '..')
$DistDir = Join-Path $RepoRoot 'dist'
$AppName = 'Plan Usage Meter'
$TargetExe = Join-Path $InstallDir "$AppName.exe"
$DevElectron = Join-Path $RepoRoot 'node_modules\electron\dist\electron.exe'

function Get-LatestPortableExe {
  $portable = Get-ChildItem -LiteralPath $DistDir -Filter "$AppName-*-portable.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $portable) {
    throw "No portable build found in $DistDir. Run npm run dist:portable first."
  }

  return $portable.FullName
}

function Stop-ProcessByPath {
  param([string]$Path)

  if (-not $Path) { return }
  $resolved = $null
  try {
    $resolved = [System.IO.Path]::GetFullPath($Path)
  } catch {
    return
  }

  Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      try {
        $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -ieq $resolved)
      } catch {
        $false
      }
    } |
    ForEach-Object {
      Write-Host "Stopping $($_.ProcessName) ($($_.Id))"
      Stop-Process -Id $_.Id -Force
    }
}

function New-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$ExecutablePath,
    [string]$WorkingDirectory
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $ExecutablePath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.IconLocation = "$ExecutablePath,0"
  $shortcut.Description = $AppName
  $shortcut.Save()
}

$SourceExe = Get-LatestPortableExe
Write-Host "Installing $SourceExe"

Stop-ProcessByPath $TargetExe
Stop-ProcessByPath $DevElectron

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -LiteralPath $SourceExe -Destination $TargetExe -Force

$Desktop = [Environment]::GetFolderPath('Desktop')
$DesktopShortcut = Join-Path $Desktop "$AppName.lnk"
New-Shortcut -ShortcutPath $DesktopShortcut -ExecutablePath $TargetExe -WorkingDirectory $InstallDir
Write-Host "Desktop shortcut: $DesktopShortcut"

if ($StartupShortcut) {
  $Startup = [Environment]::GetFolderPath('Startup')
  $StartupLink = Join-Path $Startup "$AppName.lnk"
  New-Shortcut -ShortcutPath $StartupLink -ExecutablePath $TargetExe -WorkingDirectory $InstallDir
  Write-Host "Startup shortcut: $StartupLink"
}

if (-not $NoLaunch) {
  Start-Process -FilePath $TargetExe -WorkingDirectory $InstallDir
  Write-Host "Launched $TargetExe"
}

Write-Host "Installed to $TargetExe"
