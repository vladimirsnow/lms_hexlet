param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StoreRoot = Join-Path $ProjectRoot ".local-services/object-storage"
$BuildRoot = Join-Path $StoreRoot "minio-build"
$Minio = Join-Path $BuildRoot "bin\minio.exe"
$Mc = Join-Path $BuildRoot "bin\mc.exe"
$EnvironmentFile = Join-Path $ProjectRoot ".env"
$PidFile = Join-Path $StoreRoot "minio.pid"
$EndpointFile = Join-Path $StoreRoot "minio-endpoint.txt"
$ReadyFile = Join-Path $StoreRoot "minio-ready.txt"
$LogFile = Join-Path $StoreRoot "minio.log"
$ErrorLogFile = Join-Path $StoreRoot "minio-error.log"

function Get-EnvironmentValue([string]$Name, [string]$Text, [string]$Default = "") {
  $pattern = "(?m)^$([regex]::Escape($Name))=(.*)$"
  $match = [regex]::Match($Text, $pattern)
  if (-not $match.Success) { return $Default }
  return $match.Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Set-EnvironmentValue([string]$Text, [string]$Name, [string]$Value) {
  $pattern = "^$([regex]::Escape($Name))=.*$"
  $lines = [Collections.Generic.List[string]]::new()
  $found = $false
  foreach ($line in ($Text -split "`r?`n")) {
    if (-not $found -and $line -match $pattern) {
      $lines.Add("$Name=$Value")
      $found = $true
    } else {
      $lines.Add($line)
    }
  }
  if (-not $found) { $lines.Add("$Name=$Value") }
  return ($lines -join "`r`n").TrimEnd("`r", "`n") + "`r`n"
}

function Get-ExpectedProcess([int]$ProcessId) {
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process -or -not (Test-Path -LiteralPath $Minio)) { return $null }
  try {
    if ([string]::Equals((Resolve-Path -LiteralPath $process.Path).Path, (Resolve-Path -LiteralPath $Minio).Path, [StringComparison]::OrdinalIgnoreCase)) {
      return $process
    }
  } catch { return $null }
  return $null
}

function Test-PortAvailable([int]$Port) {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
  try {
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    $listener.Stop()
  }
}

function Invoke-Mc([string[]]$Arguments, [string]$Step) {
  & $Mc @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE." }
}

function Test-Mc([string[]]$Arguments) {
  $priorErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $null = & $Mc @Arguments 2>&1
    return ($LASTEXITCODE -eq 0)
  } finally {
    $ErrorActionPreference = $priorErrorActionPreference
  }
}

switch ($Action) {
  "start" {
    if (-not (Test-Path -LiteralPath $EnvironmentFile)) { throw "Project .env file is missing." }
    if (-not (Test-Path -LiteralPath $Minio) -or -not (Test-Path -LiteralPath $Mc)) {
      throw "MinIO Community runtime is not built. Run npm run storage:local:build first."
    }

    if (Test-Path -LiteralPath $PidFile) {
      $existingPid = 0
      [void][int]::TryParse((Get-Content -LiteralPath $PidFile -TotalCount 1), [ref]$existingPid)
      if ($existingPid -gt 0 -and (Get-ExpectedProcess $existingPid)) {
        if (Test-Path -LiteralPath $ReadyFile) {
          $existingEndpoint = if (Test-Path -LiteralPath $EndpointFile) { (Get-Content -LiteralPath $EndpointFile -Raw).Trim() } else { "127.0.0.1:9000" }
          Write-Output "Local MinIO is already running at http://$existingEndpoint."
          exit 0
        }
        Stop-Process -Id $existingPid -Force
        Wait-Process -Id $existingPid -Timeout 10 -ErrorAction SilentlyContinue
      }
      Remove-Item -LiteralPath $PidFile -Force
    }
    if (Test-Path -LiteralPath $ReadyFile) { Remove-Item -LiteralPath $ReadyFile -Force }

    $originalEnvironmentText = [IO.File]::ReadAllText($EnvironmentFile)
    $environmentText = $originalEnvironmentText
    $rootUser = Get-EnvironmentValue "MINIO_ROOT_USER" $environmentText
    $rootPassword = Get-EnvironmentValue "MINIO_ROOT_PASSWORD" $environmentText
    $accessKey = Get-EnvironmentValue "MINIO_ACCESS_KEY" $environmentText
    $secretKey = Get-EnvironmentValue "MINIO_SECRET_KEY" $environmentText
    $bucket = Get-EnvironmentValue "MINIO_BUCKET" $environmentText
    $appUrl = Get-EnvironmentValue "APP_URL" $environmentText
    $domain = Get-EnvironmentValue "APP_DOMAIN" $environmentText "localhost"
    $corsOrigins = Get-EnvironmentValue "MINIO_API_CORS_ALLOW_ORIGIN" $environmentText

    if ($rootUser.Length -lt 3 -or $rootPassword.Length -lt 8 -or $rootPassword -match "replace-with|change-me") {
      throw "Set separate local MINIO_ROOT_USER and MINIO_ROOT_PASSWORD values in .env."
    }
    if ($accessKey.Length -lt 3 -or $secretKey.Length -lt 8 -or $secretKey -match "replace-with|change-me") {
      throw "Set local MINIO_ACCESS_KEY and MINIO_SECRET_KEY values in .env."
    }
    if ($rootUser -eq $accessKey -or $rootPassword -eq $secretKey) {
      throw "MinIO root and application credentials must be different."
    }
    if ($bucket -notmatch "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$") { throw "MINIO_BUCKET is not a valid bucket name." }
    try { $appOrigin = ([Uri]$appUrl).GetLeftPart([UriPartial]::Authority) } catch { throw "APP_URL must be an absolute URL." }
    if (-not $corsOrigins) {
      $defaultCorsOrigins = @($appOrigin, "http://127.0.0.1:3000", "http://localhost:3000", "https://$domain") | Select-Object -Unique
      $corsOrigins = $defaultCorsOrigins -join ","
    }
    $corsOriginList = @($corsOrigins.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($corsOriginList -notcontains "*" -and $corsOriginList -notcontains $appOrigin) {
      throw "MINIO_API_CORS_ALLOW_ORIGIN must contain the APP_URL origin ($appOrigin)."
    }

    $dataDirectory = Get-EnvironmentValue "LOCAL_MINIO_DATA_DIR" $environmentText
    if (-not $dataDirectory) { $dataDirectory = Join-Path $StoreRoot "minio-data" }
    elseif (-not [IO.Path]::IsPathRooted($dataDirectory)) { $dataDirectory = Join-Path $ProjectRoot $dataDirectory }
    $dataDirectory = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($dataDirectory))
    $rustfsDataDirectory = Get-EnvironmentValue "LOCAL_OBJECT_STORE_DATA_DIR" $environmentText
    if (-not $rustfsDataDirectory) { $rustfsDataDirectory = Join-Path $StoreRoot "data" }
    elseif (-not [IO.Path]::IsPathRooted($rustfsDataDirectory)) { $rustfsDataDirectory = Join-Path $ProjectRoot $rustfsDataDirectory }
    if ([string]::Equals([IO.Path]::GetFullPath($rustfsDataDirectory), $dataDirectory, [StringComparison]::OrdinalIgnoreCase)) {
      throw "MinIO must use a data directory separate from RustFS."
    }

    $configuredEndpoint = Get-EnvironmentValue "MINIO_ENDPOINT" $environmentText "127.0.0.1:9000"
    $preferredPort = 9000
    if ($configuredEndpoint -match ":(\d+)$") { $preferredPort = [int]$Matches[1] }
    $apiPort = 0
    $consolePort = 0
    foreach ($candidate in @($preferredPort) + @(9000..9010 | Where-Object { $_ -ne $preferredPort })) {
      if (-not (Test-PortAvailable $candidate)) { continue }
      $consoleCandidate = @(9001..9011 | Where-Object { $_ -ne $candidate -and (Test-PortAvailable $_) } | Select-Object -First 1)
      if ($consoleCandidate.Count -eq 0) { continue }
      $apiPort = $candidate
      $consolePort = $consoleCandidate[0]
      break
    }
    if ($apiPort -eq 0) { throw "No free loopback ports were found for MinIO API and console." }

    $environmentText = Set-EnvironmentValue $environmentText "MINIO_ENDPOINT" "127.0.0.1:$apiPort"
    $environmentText = Set-EnvironmentValue $environmentText "MINIO_API_CORS_ALLOW_ORIGIN" $corsOrigins
    $environmentText = Set-EnvironmentValue $environmentText "LOCAL_OBJECT_STORAGE_PROVIDER" "minio-community"
    [IO.File]::WriteAllText($EnvironmentFile, $environmentText, [Text.UTF8Encoding]::new($false))

    New-Item -ItemType Directory -Force -Path $StoreRoot, $dataDirectory | Out-Null
    $priorRootUser = $env:MINIO_ROOT_USER
    $priorRootPassword = $env:MINIO_ROOT_PASSWORD
    $priorCorsOrigins = $env:MINIO_API_CORS_ALLOW_ORIGIN
    try {
      $env:MINIO_ROOT_USER = $rootUser
      $env:MINIO_ROOT_PASSWORD = $rootPassword
      $env:MINIO_API_CORS_ALLOW_ORIGIN = $corsOrigins
      $process = Start-Process -FilePath $Minio -ArgumentList @("server", $dataDirectory, "--address", "127.0.0.1:$apiPort", "--console-address", "127.0.0.1:$consolePort") -WorkingDirectory $StoreRoot -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLogFile -PassThru
    } finally {
      $env:MINIO_ROOT_USER = $priorRootUser
      $env:MINIO_ROOT_PASSWORD = $priorRootPassword
      $env:MINIO_API_CORS_ALLOW_ORIGIN = $priorCorsOrigins
      $rootPassword = $null
      $secretKey = $null
    }

    Set-Content -LiteralPath $PidFile -Value $process.Id -NoNewline -Encoding ascii
    Set-Content -LiteralPath $EndpointFile -Value "127.0.0.1:$apiPort" -NoNewline -Encoding ascii
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      if (-not (Test-PortAvailable $apiPort) -and (Get-ExpectedProcess $process.Id)) {
        try {
          $response = Invoke-WebRequest -Uri "http://127.0.0.1:$apiPort/minio/health/ready" -TimeoutSec 2 -UseBasicParsing
          if ($response.StatusCode -eq 200) { $ready = $true }
        } catch { }
      }
      if ($ready) { break }
      if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Seconds 1
    }
    if (-not $ready) {
      $tail = Get-Content -LiteralPath $ErrorLogFile -Tail 30 -ErrorAction SilentlyContinue
      $process.Refresh()
      if (-not $process.HasExited -and (Get-ExpectedProcess $process.Id)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
      }
      if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
        $startedPid = 0
        if ([int]::TryParse((Get-Content -LiteralPath $PidFile -Raw).Trim(), [ref]$startedPid) -and $startedPid -eq $process.Id) {
          Remove-Item -LiteralPath $PidFile -Force
        }
      }
      if ((Test-Path -LiteralPath $EndpointFile -PathType Leaf) -and
          (Get-Content -LiteralPath $EndpointFile -Raw).Trim() -eq "127.0.0.1:$apiPort") {
        Remove-Item -LiteralPath $EndpointFile -Force
      }
      if (Test-Path -LiteralPath $ReadyFile -PathType Leaf) { Remove-Item -LiteralPath $ReadyFile -Force }
      if ([string]::Equals([IO.File]::ReadAllText($EnvironmentFile), $environmentText, [StringComparison]::Ordinal)) {
        [IO.File]::WriteAllText($EnvironmentFile, $originalEnvironmentText, [Text.UTF8Encoding]::new($false))
      }
      throw "MinIO did not become ready. Review $LogFile and $ErrorLogFile. $($tail -join ' ')"
    }

    $env:MC_CONFIG_DIR = Join-Path $BuildRoot "mc-config"
    New-Item -ItemType Directory -Force -Path $env:MC_CONFIG_DIR | Out-Null
    $endpointUrl = "http://127.0.0.1:$apiPort"
    Invoke-Mc @("alias", "set", "local", $endpointUrl, $rootUser, (Get-EnvironmentValue "MINIO_ROOT_PASSWORD" $environmentText), "--api", "S3v4") "Configure the local MinIO administrator"
    Invoke-Mc @("mb", "--ignore-existing", "local/$bucket") "Create the private MinIO bucket"

    $policyName = "lms-app-$bucket"
    $policyTemplate = [IO.File]::ReadAllText((Join-Path $ProjectRoot "minio\lms-app-policy.template.json"))
    $policyPath = Join-Path $BuildRoot "lms-app-policy.json"
    [IO.File]::WriteAllText($policyPath, $policyTemplate.Replace("__MINIO_BUCKET__", $bucket), [Text.UTF8Encoding]::new($false))
    if (-not (Test-Mc @("admin", "policy", "info", "local", $policyName))) {
      Invoke-Mc @("admin", "policy", "create", "local", $policyName, $policyPath) "Create the private bucket policy"
    }
    if (-not (Test-Mc @("admin", "user", "info", "local", $accessKey))) {
      Invoke-Mc @("admin", "user", "add", "local", $accessKey, (Get-EnvironmentValue "MINIO_SECRET_KEY" $environmentText)) "Create the application user"
    }
    $null = Test-Mc @("admin", "policy", "detach", "local", $policyName, "--user", $accessKey)
    Invoke-Mc @("admin", "policy", "attach", "local", $policyName, "--user", $accessKey) "Attach the application bucket policy"

    $env:MINIO_ENDPOINT = "127.0.0.1:$apiPort"
    $env:MINIO_BUCKET = $bucket
    $env:MINIO_ACCESS_KEY = $accessKey
    $env:MINIO_SECRET_KEY = Get-EnvironmentValue "MINIO_SECRET_KEY" $environmentText
    $env:MINIO_ROOT_USER = Get-EnvironmentValue "MINIO_ROOT_USER" $environmentText
    $env:MINIO_ROOT_PASSWORD = Get-EnvironmentValue "MINIO_ROOT_PASSWORD" $environmentText
    $env:MINIO_API_CORS_ALLOW_ORIGIN = $corsOrigins
    $env:LOCAL_OBJECT_STORAGE_PROVIDER = "minio-community"
    & npm run storage:local:provision
    if ($LASTEXITCODE -ne 0) { throw "S3 application-user provisioning check failed with exit code $LASTEXITCODE." }

    $corsHeaders = @{
      Origin = $appOrigin
      "Access-Control-Request-Method" = "POST"
      "Access-Control-Request-Headers" = "content-type,x-amz-date,x-amz-credential,x-amz-algorithm,x-amz-signature"
    }
    $preflight = Invoke-WebRequest -Uri "$endpointUrl/$bucket/cors-check.txt" -Method Options -Headers $corsHeaders -UseBasicParsing
    $allowedOrigin = [string]($preflight.Headers["Access-Control-Allow-Origin"] -join ",")
    if ($allowedOrigin -ne $appOrigin) { throw "MinIO did not grant browser CORS to the configured APP_URL origin." }

    Set-Content -LiteralPath $ReadyFile -Value "ready" -NoNewline -Encoding ascii
    Write-Output "Local MinIO Community is ready at http://127.0.0.1:$apiPort with private bucket $bucket and restricted app credentials."
    Write-Output "Data directory: $dataDirectory. CORS is restricted to the configured origin allowlist."
  }
  "stop" {
    if (-not (Test-Path -LiteralPath $PidFile)) { Write-Output "Local MinIO is not running."; exit 0 }
    $processId = 0
    [void][int]::TryParse((Get-Content -LiteralPath $PidFile -TotalCount 1), [ref]$processId)
    $process = if ($processId -gt 0) { Get-ExpectedProcess $processId } else { $null }
    if ($process) { Stop-Process -Id $process.Id -Force; Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $PidFile -Force
    if (Test-Path -LiteralPath $EndpointFile) { Remove-Item -LiteralPath $EndpointFile -Force }
    if (Test-Path -LiteralPath $ReadyFile) { Remove-Item -LiteralPath $ReadyFile -Force }
    Write-Output "Local MinIO stopped. Its data directory was kept."
  }
  "status" {
    if (-not (Test-Path -LiteralPath $PidFile)) { Write-Output "Local MinIO is not running."; exit 0 }
    $processId = 0
    [void][int]::TryParse((Get-Content -LiteralPath $PidFile -TotalCount 1), [ref]$processId)
    $process = if ($processId -gt 0) { Get-ExpectedProcess $processId } else { $null }
    if (-not $process) { Write-Output "Local MinIO is stopped (stale PID file)."; exit 1 }
    if (-not (Test-Path -LiteralPath $ReadyFile)) {
      Write-Output "Local MinIO is running, but provisioning did not finish. Run npm run storage:local:start again."
      exit 1
    }
    $endpoint = if (Test-Path -LiteralPath $EndpointFile) { (Get-Content -LiteralPath $EndpointFile -Raw).Trim() } else { "127.0.0.1:9000" }
    $response = Invoke-WebRequest -Uri "http://$endpoint/minio/health/ready" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ne 200) { throw "MinIO process exists but its health endpoint is not ready." }
    Write-Output "Local MinIO is running at http://$endpoint (PID $processId)."
  }
}
