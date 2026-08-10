param(
  [string]$Destination = (Join-Path $PSScriptRoot '..\backups\snapshots'),
  [ValidateRange(1, 3650)][int]$Keep = 14,
  [switch]$DisableCleanup
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$snapshotRoot = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $snapshotRoot | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$snapshot = Join-Path $snapshotRoot $stamp
New-Item -ItemType Directory -Force -Path $snapshot | Out-Null

Push-Location $projectRoot
try {
  & npm.cmd run backup:database -- $snapshot
  if ($LASTEXITCODE) { throw 'Database backup failed.' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/backup-files.ps1 -Destination $snapshot
  if ($LASTEXITCODE) { throw 'Files backup failed.' }
  & npm.cmd run verify:backup -- $snapshot
  if ($LASTEXITCODE) { throw 'Backup smoke check failed.' }

  $package = Get-Content -Raw package.json | ConvertFrom-Json
  try { $commit = (& git rev-parse --short HEAD).Trim() } catch { $commit = $null }
  $artifacts = Get-ChildItem -LiteralPath $snapshot -File | Where-Object { $_.Name -match '\.(json\.gz|zip)$' } | ForEach-Object {
    [ordered]@{ fileName = $_.Name; sizeBytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  $manifest = [ordered]@{
    format = 'izlk-snapshot-manifest-v1'
    status = 'complete'
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    application = [ordered]@{ name = $package.name; version = $package.version; commit = $commit }
    artifacts = @($artifacts)
  }
  [System.IO.File]::WriteAllText((Join-Path $snapshot 'snapshot-manifest.json'), ($manifest | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
  & npm.cmd run verify:backup -- $snapshot
  if ($LASTEXITCODE) { throw 'Final snapshot verification failed.' }
}
finally { Pop-Location }

if (-not $DisableCleanup) {
  $rootWithSeparator = $snapshotRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  $expired = @(Get-ChildItem -LiteralPath $snapshotRoot -Directory | Sort-Object LastWriteTimeUtc -Descending | Select-Object -Skip $Keep)
  foreach ($directory in $expired) {
    $fullPath = [System.IO.Path]::GetFullPath($directory.FullName)
    if (-not $fullPath.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Refusing cleanup outside snapshot directory: $fullPath" }
    Remove-Item -LiteralPath $fullPath -Recurse -Force
  }
}

Write-Output "Complete snapshot created and verified: $snapshot"
