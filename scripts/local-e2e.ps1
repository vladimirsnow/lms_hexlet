$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$postgresBin = Join-Path $projectRoot ".local-services/postgres/runtime/pgsql/bin"
$initdb = Join-Path $postgresBin "initdb.exe"
$pgCtl = Join-Path $postgresBin "pg_ctl.exe"
$createdb = Join-Path $postgresBin "createdb.exe"
$psql = Join-Path $postgresBin "psql.exe"
$runId = [guid]::NewGuid().ToString("N")
$e2eRoot = Join-Path $projectRoot ".local-services/postgres/e2e-$runId"
$dataDirectory = Join-Path $e2eRoot "data"
$logFile = Join-Path $e2eRoot "postgres.log"
$databasePort = 5434
$appPort = 3100
$tsconfigPath = Join-Path $projectRoot "tsconfig.json"
$originalTsconfig = [IO.File]::ReadAllBytes($tsconfigPath)
$postgresStarted = $false
$runSucceeded = $false
$databaseStopped = $false

function Invoke-ProjectCommand([string]$Executable, [string[]]$Arguments, [string]$Step) {
  Write-Host "--- $Step ---"
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE."
  }
}

Push-Location $projectRoot
try {
  if (-not (Test-Path -LiteralPath $initdb) -or -not (Test-Path -LiteralPath $pgCtl) -or -not (Test-Path -LiteralPath $createdb)) {
    throw "Local PostgreSQL binaries are missing. Run npm run db:local:start once to provision them."
  }

  New-Item -ItemType Directory -Path $e2eRoot -Force | Out-Null
  $passwordBytes = New-Object byte[] 24
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
  $env:E2E_PASSWORD = "E2e-" + [Convert]::ToBase64String($passwordBytes).Replace("+", "A").Replace("/", "b").TrimEnd("=") + "!9Z"
  $env:E2E_MODE = "true"
  $env:E2E_BASE_URL = "http://127.0.0.1:$appPort"
  $env:NODE_ENV = "development"
  # The API upload/download cases run before the separate worker scanner fixture.
  # The scanner itself is exercised directly when E2E_CLAMAV_RUNTIME=true.
  $env:FILE_SCAN_REQUIRED = "false"
  $env:NEXT_DIST_DIR = ".next-e2e"
  $env:APP_URL = $env:E2E_BASE_URL
  $env:DATABASE_URL = "postgresql://lms_e2e@127.0.0.1:$databasePort/lms_e2e?schema=public"
  $env:DIRECT_URL = $env:DATABASE_URL

  & $initdb -D $dataDirectory -U lms_e2e --auth=trust --no-locale --encoding=UTF8
  if ($LASTEXITCODE -ne 0) { throw "Could not initialize the disposable E2E database." }

  $startedOnPort = $false
  for ($candidatePort = $databasePort; $candidatePort -le ($databasePort + 10); $candidatePort++) {
    $candidateLog = Join-Path $e2eRoot "postgres-$candidatePort.log"
    & $pgCtl -D $dataDirectory -l $candidateLog -o "-h 127.0.0.1 -p $candidatePort -c timezone=UTC" -w start
    if ($LASTEXITCODE -eq 0) {
      $databasePort = $candidatePort
      $env:DATABASE_URL = "postgresql://lms_e2e@127.0.0.1:$databasePort/lms_e2e?schema=public"
      $env:DIRECT_URL = $env:DATABASE_URL
      $postgresStarted = $true
      $startedOnPort = $true
      break
    }

    $startupLog = Get-Content -LiteralPath $candidateLog -Tail 20 -ErrorAction SilentlyContinue
    if (($startupLog -join "`n") -notmatch "could not bind|could not create listen socket|address.*permitted") {
      throw "PostgreSQL failed to start. See $candidateLog."
    }
  }
  if (-not $startedOnPort) { throw "No free localhost port was found for the disposable E2E database." }

  & $createdb --host=127.0.0.1 --port=$databasePort --username=lms_e2e lms_e2e
  if ($LASTEXITCODE -ne 0) { throw "Could not create the disposable lms_e2e database." }
  & $psql --no-psqlrc --host=127.0.0.1 --port=$databasePort --username=lms_e2e --dbname=lms_e2e --command "ALTER DATABASE lms_e2e SET timezone TO 'UTC';"
  if ($LASTEXITCODE -ne 0) { throw "Could not configure UTC timestamps for the disposable E2E database." }

  Invoke-ProjectCommand "npm" @("run", "prisma:generate") "Generate Prisma Client"
  Invoke-ProjectCommand "npm" @("run", "db:deploy") "Apply migrations to isolated E2E database"
  Invoke-ProjectCommand "npm" @("run", "db:seed") "Seed system settings"
  Invoke-ProjectCommand "npx" @("tsx", "scripts/seed-e2e-users.ts") "Create isolated role accounts"
  Invoke-ProjectCommand "npm" @("run", "db:seed:academic-demo") "Create isolated academic fixtures"
  Invoke-ProjectCommand "npx" @("tsx", "scripts/local-e2e-smoke.mjs") "Run local role and access smoke checks"
  $runSucceeded = $true
}
finally {
  # Next.js adds the custom .next-e2e type directory to tsconfig during dev startup.
  # Restore the exact project config so disposable E2E output does not leak into it.
  [IO.File]::WriteAllBytes($tsconfigPath, $originalTsconfig)

  if ($postgresStarted) {
    & $pgCtl -D $dataDirectory -m fast -w stop
    if ($LASTEXITCODE -eq 0) {
      $databaseStopped = $true
    } else {
      Write-Warning "Could not stop the disposable E2E PostgreSQL cluster; it was left on disk for inspection."
    }
  }

  if ($runSucceeded -and $databaseStopped -and (Test-Path -LiteralPath $e2eRoot)) {
    $workspace = (Resolve-Path -LiteralPath $projectRoot).Path.TrimEnd("\")
    $resolvedTarget = (Resolve-Path -LiteralPath $e2eRoot).Path.TrimEnd("\")
    $allowedParent = Join-Path $workspace ".local-services/postgres\e2e-"
    if (-not $resolvedTarget.StartsWith($allowedParent, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove an E2E path outside the local test directory: $resolvedTarget"
    }
    if ((Get-Item -LiteralPath $resolvedTarget -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Refusing to remove an E2E reparse point: $resolvedTarget"
    }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    Write-Host "Removed the disposable E2E database."
  } elseif (-not $runSucceeded) {
    Write-Host "The isolated E2E database was retained at $e2eRoot for diagnosis."
  }
  Pop-Location
}
