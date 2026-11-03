$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildRoot = Join-Path $ProjectRoot ".local-services/object-storage\minio-build"
$DownloadDirectory = Join-Path $BuildRoot "downloads"
$ArchivePath = Join-Path $DownloadDirectory "go1.24.13.windows-amd64.zip"
$GoRoot = Join-Path $BuildRoot "toolchain\go"
$GoExecutable = Join-Path $GoRoot "bin\go.exe"
$BinDirectory = Join-Path $BuildRoot "bin"
$GopathDirectory = Join-Path $BuildRoot "gopath"
$ModuleCacheDirectory = Join-Path $BuildRoot "modcache"
$BuildCacheDirectory = Join-Path $BuildRoot "buildcache"
$ArchiveSha256 = "40b16bc8f00540a2cb02dff4de72b73e966fdd8d65f95e33d8e4080b48a2459a"
$MinioVersion = "RELEASE.2025-10-15T17-29-55Z"
$McVersion = "RELEASE.2025-08-13T08-35-41Z"
$ExpectedMinioModuleVersion = "v0.0.0-20251015172955-9e49d5e7a648"
$ExpectedMcModuleVersion = "v0.0.0-20250813083541-7394ce0dd2a8"

New-Item -ItemType Directory -Force -Path $DownloadDirectory, $BinDirectory, $GopathDirectory, $ModuleCacheDirectory, $BuildCacheDirectory | Out-Null

if (-not (Test-Path -LiteralPath $ArchivePath)) {
  Write-Output "Downloading the official portable Go 1.24.13 archive into .local-services/object-storage."
  Invoke-WebRequest -Uri "https://go.dev/dl/go1.24.13.windows-amd64.zip" -OutFile $ArchivePath -UseBasicParsing
}

$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
$archiveStream = [IO.File]::OpenRead($ArchivePath)
try {
  $ActualSha256 = ([BitConverter]::ToString($hashAlgorithm.ComputeHash($archiveStream))).Replace("-", "").ToLowerInvariant()
} finally {
  $archiveStream.Dispose()
  $hashAlgorithm.Dispose()
}
if ($ActualSha256 -ne $ArchiveSha256) {
  throw "Go archive SHA-256 mismatch. Expected $ArchiveSha256, received $ActualSha256."
}

if (-not (Test-Path -LiteralPath $GoExecutable)) {
  Write-Output "Extracting the verified Go toolchain."
  $ToolchainDirectory = Split-Path -Parent $GoRoot
  New-Item -ItemType Directory -Force -Path $ToolchainDirectory | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ToolchainDirectory -Force
}

$PreviousEnvironment = @{}
foreach ($Name in @("GOTOOLCHAIN", "GOPATH", "GOMODCACHE", "GOCACHE", "GOBIN")) {
  $PreviousEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process")
}

try {
  $env:GOTOOLCHAIN = "local"
  $env:GOPATH = $GopathDirectory
  $env:GOMODCACHE = $ModuleCacheDirectory
  $env:GOCACHE = $BuildCacheDirectory
  $env:GOBIN = $BinDirectory

  if (-not (Test-Path -LiteralPath (Join-Path $BinDirectory "minio.exe"))) {
    Write-Output "Building MinIO Community $MinioVersion from its pinned upstream Go module."
    & $GoExecutable install "github.com/minio/minio@$MinioVersion"
    if ($LASTEXITCODE -ne 0) { throw "MinIO build failed with exit code $LASTEXITCODE." }
  }

  if (-not (Test-Path -LiteralPath (Join-Path $BinDirectory "mc.exe"))) {
    Write-Output "Building MinIO Client $McVersion from its pinned upstream Go module."
    & $GoExecutable install "github.com/minio/mc@$McVersion"
    if ($LASTEXITCODE -ne 0) { throw "MinIO Client build failed with exit code $LASTEXITCODE." }
  }
} finally {
  foreach ($Name in $PreviousEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($Name, $PreviousEnvironment[$Name], "Process")
  }
}

Write-Output "Verified portable toolchain: $(& $GoExecutable version)"
$MinioBuildInfo = & $GoExecutable version -m (Join-Path $BinDirectory "minio.exe")
if ($LASTEXITCODE -ne 0 -or ($MinioBuildInfo -join "`n") -notmatch "(?m)^\s*mod\s+github\.com/minio/minio\s+$([regex]::Escape($ExpectedMinioModuleVersion))\s") {
  throw "Built MinIO binary does not contain the expected source module $ExpectedMinioModuleVersion."
}
$McBuildInfo = & $GoExecutable version -m (Join-Path $BinDirectory "mc.exe")
if ($LASTEXITCODE -ne 0 -or ($McBuildInfo -join "`n") -notmatch "(?m)^\s*mod\s+github\.com/minio/mc\s+$([regex]::Escape($ExpectedMcModuleVersion))\s") {
  throw "Built MinIO Client binary does not contain the expected source module $ExpectedMcModuleVersion."
}
Write-Output "Built MinIO module ${MinioVersion} (${ExpectedMinioModuleVersion}); binary metadata: $(& (Join-Path $BinDirectory "minio.exe") --version | Select-Object -First 1)"
Write-Output "Built MinIO Client module ${McVersion} (${ExpectedMcModuleVersion}); binary metadata: $(& (Join-Path $BinDirectory "mc.exe") --version | Select-Object -First 1)"
