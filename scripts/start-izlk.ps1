$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot

try {
  $Host.UI.RawUI.WindowTitle = 'IZLK - system startup'
} catch {}

# A second double-click must not try to replace Prisma files while the site is running.
try {
  Invoke-WebRequest -Uri 'http://localhost:3000/login' -UseBasicParsing -TimeoutSec 2 | Out-Null
  Write-Host 'IZLK is already running. Opening the site...' -ForegroundColor Green
  if ($env:IZLK_NO_BROWSER -ne '1') { Start-Process 'http://localhost:3000' }
  exit 0
} catch {}

function Invoke-Step {
  param(
    [string]$Title,
    [string]$Command,
    [string[]]$Arguments
  )

  Write-Host $Title -ForegroundColor Cyan
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Command $($Arguments -join ' ')"
  }
}

try {
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js is not installed. Install Node.js LTS and try again.'
  }

  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    Invoke-Step -Title 'First launch: installing components...' -Command 'npm.cmd' -Arguments @('install')
  }

  Invoke-Step -Title 'Checking database structure...' -Command 'npx.cmd' -Arguments @('prisma', 'migrate', 'deploy')
  Invoke-Step -Title 'Updating database client...' -Command 'npx.cmd' -Arguments @('prisma', 'generate')
  Invoke-Step -Title 'Building the production version...' -Command 'npm.cmd' -Arguments @('run', 'build')

  Write-Host ''
  Write-Host 'IZLK is starting at http://localhost:3000' -ForegroundColor Green
  Write-Host 'The incoming folder is monitored automatically every 5 seconds.' -ForegroundColor Green
  Write-Host 'Keep this window open while the system is in use.'
  Write-Host 'Press Ctrl+C or close this window to stop the system.'

  if ($env:IZLK_NO_BROWSER -ne '1') {
    Start-Job -ScriptBlock {
      Start-Sleep -Seconds 3
      Start-Process 'http://localhost:3000'
    } | Out-Null
  }

  $watcher = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'watch:inbox') -WorkingDirectory $projectRoot -NoNewWindow -PassThru
  try {
    & npm.cmd run start
    if ($LASTEXITCODE -ne 0) { throw 'The production server stopped with an error.' }
  } finally {
    if ($watcher -and -not $watcher.HasExited) { taskkill.exe /PID $watcher.Id /T /F | Out-Null }
  }
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Copy the error text from this window and send it to the developer.' -ForegroundColor Yellow
  if ($env:IZLK_NO_PAUSE -ne '1') { Read-Host 'Press Enter to close this window' }
  exit 1
}
