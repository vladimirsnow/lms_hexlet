param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StoreRoot = Join-Path $ProjectRoot ".local-services/object-storage"
$DataDirectory = Join-Path $StoreRoot "data"
$LogFile = Join-Path $StoreRoot "rustfs.log"
$ErrorLogFile = Join-Path $StoreRoot "rustfs-error.log"
$PidFile = Join-Path $StoreRoot "rustfs.pid"
$EndpointFile = Join-Path $StoreRoot "endpoint.txt"
$EnvironmentFile = Join-Path $ProjectRoot ".env"
$configuredEnvironmentFile = if (Test-Path -LiteralPath $EnvironmentFile) { [IO.File]::ReadAllText($EnvironmentFile) } else { "" }
$dataDirectoryMatch = [regex]::Match($configuredEnvironmentFile, '(?m)^LOCAL_OBJECT_STORE_DATA_DIR=(.*)$')
if ($dataDirectoryMatch.Success) {
  $configuredDataDirectory = $dataDirectoryMatch.Groups[1].Value.Trim().Trim('"').Trim("'")
  if ($configuredDataDirectory) {
    $DataDirectory = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($configuredDataDirectory))
  }
}
$RustFs = Get-ChildItem -LiteralPath (Join-Path $StoreRoot "bin") -Filter "rustfs.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

function Get-LocalEnvironmentValue([string]$Name, [string]$Text) {
  $pattern = "(?m)^$([regex]::Escape($Name))=(.*)$"
  $match = [regex]::Match($Text, $pattern)
  if (-not $match.Success) { throw "Required setting $Name is missing from .env." }
  return $match.Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Get-ExpectedProcess([int]$ProcessId) {
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process -or -not $RustFs) { return $null }
  try {
    if ([string]::Equals((Resolve-Path -LiteralPath $process.Path).Path, (Resolve-Path -LiteralPath $RustFs.FullName).Path, [StringComparison]::OrdinalIgnoreCase)) {
      return $process
    }
  } catch { return $null }
  return $null
}

function Get-ListeningPort([int]$Port) {
  return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}

switch ($Action) {
  "start" {
    if (-not (Test-Path -LiteralPath $EnvironmentFile)) { throw "Project .env file is missing." }
    if (-not $RustFs) { throw "RustFS is not installed under $StoreRoot\bin. See the local S3 setup guide." }
    New-Item -ItemType Directory -Path $StoreRoot, $DataDirectory -Force | Out-Null

    if (Test-Path -LiteralPath $PidFile) {
      $oldPid = 0
      [void][int]::TryParse((Get-Content -LiteralPath $PidFile -TotalCount 1), [ref]$oldPid)
      if ($oldPid -gt 0 -and (Get-ExpectedProcess $oldPid)) {
        $endpoint = if (Test-Path -LiteralPath $EndpointFile) { (Get-Content -LiteralPath $EndpointFile -Raw).Trim() } else { "127.0.0.1:9000" }
        Write-Output "Local RustFS is already running at http://$endpoint."
        exit 0
      }
      Remove-Item -LiteralPath $PidFile -Force
    }

    $envText = [IO.File]::ReadAllText($EnvironmentFile)
    $accessKey = Get-LocalEnvironmentValue "MINIO_ACCESS_KEY" $envText
    $secretKey = Get-LocalEnvironmentValue "MINIO_SECRET_KEY" $envText
    if ($accessKey.Length -lt 3 -or $secretKey.Length -lt 8 -or $accessKey -match "replace-with|change-me" -or $secretKey -match "replace-with|change-me") {
      throw "Set unique local MINIO_ACCESS_KEY and MINIO_SECRET_KEY values in .env before starting RustFS."
    }

    $apiPort = 9000
    while ($apiPort -le 9010 -and (Get-ListeningPort $apiPort)) { $apiPort++ }
    if ($apiPort -gt 9010) { throw "No free localhost port was found for local object storage." }

    $endpointPattern = "(?m)^MINIO_ENDPOINT=.*$"
    $endpointRegex = [regex]::new($endpointPattern)
    $updatedEnv = if ($endpointRegex.IsMatch($envText)) {
      $endpointRegex.Replace($envText, "MINIO_ENDPOINT=127.0.0.1:$apiPort", 1)
    } else {
      $envText.TrimEnd("`r", "`n") + "`r`nMINIO_ENDPOINT=127.0.0.1:$apiPort`r`n"
    }
    $providerPattern = "(?m)^LOCAL_OBJECT_STORAGE_PROVIDER=.*$"
    $providerRegex = [regex]::new($providerPattern)
    $updatedEnv = if ($providerRegex.IsMatch($updatedEnv)) {
      $providerRegex.Replace($updatedEnv, "LOCAL_OBJECT_STORAGE_PROVIDER=rustfs", 1)
    } else {
      $updatedEnv.TrimEnd("`r", "`n") + "`r`nLOCAL_OBJECT_STORAGE_PROVIDER=rustfs`r`n"
    }
    [IO.File]::WriteAllText($EnvironmentFile, $updatedEnv, [Text.UTF8Encoding]::new($false))

    $priorAccessKey = $env:RUSTFS_ACCESS_KEY
    $priorSecretKey = $env:RUSTFS_SECRET_KEY
    try {
      $env:RUSTFS_ACCESS_KEY = $accessKey
      $env:RUSTFS_SECRET_KEY = $secretKey
      $process = Start-Process -FilePath $RustFs.FullName -ArgumentList @("server", "--address", "127.0.0.1:$apiPort", $DataDirectory) -WorkingDirectory $StoreRoot -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLogFile -PassThru
    } finally {
      $env:RUSTFS_ACCESS_KEY = $priorAccessKey
      $env:RUSTFS_SECRET_KEY = $priorSecretKey
      $accessKey = $null
      $secretKey = $null
    }

    Set-Content -LiteralPath $PidFile -Value $process.Id -NoNewline -Encoding ascii
    Set-Content -LiteralPath $EndpointFile -Value "127.0.0.1:$apiPort" -NoNewline -Encoding ascii
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { break }
      if (Get-ListeningPort $apiPort) { $ready = $true; break }
      Start-Sleep -Milliseconds 750
    }
    if (-not $ready) {
      throw "RustFS did not open its local API port. Review $LogFile and $ErrorLogFile."
    }
    Write-Output "Local RustFS is ready at http://127.0.0.1:$apiPort; data is stored in $DataDirectory."
  }
  "stop" {
    if (-not (Test-Path -LiteralPath $PidFile)) { Write-Output "Local RustFS is not running."; exit 0 }
    $processId = 0
    [void][int]::TryParse((Get-Content -LiteralPath $PidFile -TotalCount 1), [ref]$processId)
    $process = if ($processId -gt 0) { Get-ExpectedProcess $processId } else { $null }
    if ($process) { Stop-Process -Id $process.Id -Force; Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $PidFile -Force
    Write-Output "Local RustFS stopped."
  }
  "status" {
    if (-not (Test-Path -LiteralPath $PidFile)) { Write-Output "Local RustFS is not running."; exit 0 }
    $processId = 0
    [void][int]::TryParse((Get-Content -LiteralPath $PidFile -TotalCount 1), [ref]$processId)
    $process = if ($processId -gt 0) { Get-ExpectedProcess $processId } else { $null }
    if (-not $process) { Write-Output "Local RustFS is stopped (stale PID file)."; exit 1 }
    $endpoint = if (Test-Path -LiteralPath $EndpointFile) { (Get-Content -LiteralPath $EndpointFile -Raw).Trim() } else { "127.0.0.1:9000" }
    if (-not (Get-ListeningPort ([int]($endpoint.Split(":")[-1])))) { throw "RustFS process exists but its API port is not listening." }
    Write-Output "Local RustFS is running at http://$endpoint (PID $processId)."
  }
}
