param(
  [string]$Destination = (Join-Path $PSScriptRoot '..\backups')
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $projectRoot '.env'
$configuredStorage = $null
if (Test-Path -LiteralPath $envFile) {
  $storageLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^STORAGE_PATH=' } | Select-Object -First 1
  if ($storageLine) { $configuredStorage = ($storageLine -replace '^STORAGE_PATH=', '').Trim().Trim('"') }
}
$storageRoot = if ($env:STORAGE_PATH) { $env:STORAGE_PATH } elseif ($configuredStorage) { $configuredStorage } else { Join-Path $projectRoot 'storage' }
$storageRoot = [System.IO.Path]::GetFullPath($storageRoot)
$backupRoot = [System.IO.Path]::GetFullPath($Destination)

if (-not (Test-Path -LiteralPath $storageRoot)) {
  throw "Storage directory not found: $storageRoot"
}

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$archive = Join-Path $backupRoot "izlk-files_$stamp.zip"
Compress-Archive -LiteralPath $storageRoot -DestinationPath $archive -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
Write-Output "Backup created: $archive"
Write-Output "SHA256: $hash"
