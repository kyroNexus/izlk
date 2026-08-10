param(
  [string]$Destination = (Join-Path $PSScriptRoot '..\backups')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

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

if (-not (Test-Path -LiteralPath $storageRoot)) { throw "Storage directory not found: $storageRoot" }
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$fileName = "izlk-files_$stamp.zip"
$archive = Join-Path $backupRoot $fileName
Compress-Archive -LiteralPath $storageRoot -DestinationPath $archive -CompressionLevel Optimal

# A ZIP can be created but still be unreadable after a disk/network failure.
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try { $fileCount = @($zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') }).Count }
finally { $zip.Dispose() }

$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  format = 'izlk-files-backup-manifest-v1'
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  archive = [ordered]@{ fileName = $fileName; sizeBytes = (Get-Item -LiteralPath $archive).Length; sha256 = $hash }
  storageRoot = $storageRoot
  fileCount = $fileCount
}
$manifestPath = [System.IO.Path]::ChangeExtension($archive, 'manifest.json')
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))

Write-Output "Files backup created and verified: $archive"
Write-Output "Files: $fileCount; SHA256: $hash"
