param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PgCtl = Join-Path $ProjectRoot ".local-services/postgres/runtime/pgsql/bin/pg_ctl.exe"
$PostgresExe = Join-Path $ProjectRoot ".local-services/postgres/runtime/pgsql/bin/postgres.exe"
$PgIsReady = Join-Path $ProjectRoot ".local-services/postgres/runtime/pgsql/bin/pg_isready.exe"
$DataDirectory = Join-Path $ProjectRoot ".local-services/postgres/data"
$LogFile = Join-Path $ProjectRoot ".local-services/postgres/logs/postgres.log"
$Port = 5433
$ProjectEnv = Join-Path $ProjectRoot ".env"
if (Test-Path -LiteralPath $ProjectEnv) {
  $PortLine = Get-Content -LiteralPath $ProjectEnv | Where-Object { $_ -match '^LOCAL_POSTGRES_PORT=(\d+)$' } | Select-Object -First 1
  if ($PortLine -match '^LOCAL_POSTGRES_PORT=(\d+)$') {
    $Port = [int]$Matches[1]
  }
}
if ($Port -lt 1024 -or $Port -gt 65535) {
  throw "LOCAL_POSTGRES_PORT must be between 1024 and 65535."
}

if (-not (Test-Path -LiteralPath $PgCtl)) {
  throw "Local PostgreSQL binaries not found: $PgCtl"
}

function Test-LocalPortAvailable([int]$CandidatePort) {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $CandidatePort)
  try {
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    $listener.Stop()
  }
}

function Test-ProjectPostgresProcess([int]$ProcessId) {
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    if ($process.ProcessName -ne "postgres" -or -not $process.Path) { return $false }
    return [IO.Path]::GetFullPath($process.Path).Equals(
      [IO.Path]::GetFullPath($PostgresExe),
      [StringComparison]::OrdinalIgnoreCase
    )
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $DataDirectory "PG_VERSION"))) {
  throw "PostgreSQL data cluster is not initialized: $DataDirectory"
}

New-Item -ItemType Directory -Path (Split-Path -Parent $LogFile) -Force | Out-Null

switch ($Action) {
  "start" {
    $PidFile = Join-Path $DataDirectory "postmaster.pid"
    if (Test-Path -LiteralPath $PidFile) {
      $OldPid = 0
      [void][int]::TryParse((Get-Content -LiteralPath $PidFile -TotalCount 1), [ref]$OldPid)
      $ProjectProcess = $OldPid -gt 0 -and (Test-ProjectPostgresProcess $OldPid)
      $PortAvailable = Test-LocalPortAvailable $Port
      if ($ProjectProcess -and -not $PortAvailable) {
        & $PgCtl -D $DataDirectory status *> $null
        $ClusterIsRunning = $LASTEXITCODE -eq 0
        if (Test-Path -LiteralPath $PgIsReady) {
          & $PgIsReady -h 127.0.0.1 -p $Port -q
          $DatabaseIsReady = $LASTEXITCODE -eq 0
        } else {
          $DatabaseIsReady = $false
        }
      } else {
        $ClusterIsRunning = $false
        $DatabaseIsReady = $false
      }

      if ($ProjectProcess -and $ClusterIsRunning -and $DatabaseIsReady) {
        Write-Output "Local PostgreSQL is already running."
        exit 0
      }

      if ($PortAvailable) {
        Remove-Item -LiteralPath $PidFile -Force
      } else {
        throw "PostgreSQL port $Port cannot be bound and the recorded PID is not a ready process for this project. Check the port owner before starting."
      }
    }

    & $PgCtl -D $DataDirectory -l $LogFile -o "-h 127.0.0.1 -p $Port -c timezone=UTC" -w start
    if ($LASTEXITCODE -ne 0) {
      throw "PostgreSQL failed to start. See log: $LogFile"
    }
  }
  "stop" {
    & $PgCtl -D $DataDirectory -m fast -w stop
    if ($LASTEXITCODE -ne 0) {
      throw "PostgreSQL could not be stopped. Check npm run db:local:status."
    }
  }
  "status" {
    & $PgCtl -D $DataDirectory status
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
}
