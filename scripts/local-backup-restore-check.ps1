param()

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvironmentFile = Join-Path $ProjectRoot ".env"
$StoreRoot = Join-Path $ProjectRoot ".local-services\object-storage"
$ToolsRoot = Join-Path $ProjectRoot ".local-services\tools"
$AgeExe = Join-Path $ToolsRoot "age\bin\age.exe"
$AgeKeygenExe = Join-Path $ToolsRoot "age\bin\age-keygen.exe"
$McExe = Join-Path $StoreRoot "minio-build/bin/mc.exe"
$PgBin = Join-Path $ProjectRoot ".local-services/postgres/runtime/pgsql/bin"
$PgDump = Join-Path $PgBin "pg_dump.exe"
$PgRestore = Join-Path $PgBin "pg_restore.exe"
$PgCtl = Join-Path $PgBin "pg_ctl.exe"
$PgIsReady = Join-Path $PgBin "pg_isready.exe"
$InitDb = Join-Path $PgBin "initdb.exe"
$Psql = Join-Path $PgBin "psql.exe"

function Get-EnvironmentValue([string]$Name, [string]$Text) {
  $pattern = "(?m)^" + [regex]::Escape($Name) + "=(.*)$"
  $match = [regex]::Match($Text, $pattern)
  if (-not $match.Success) { throw "Missing $Name in .env." }
  $value = $match.Groups[1].Value.Trim()
  if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
    return $value.Substring(1, $value.Length - 2)
  }
  if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
    return $value.Substring(1, $value.Length - 2)
  }
  return $value
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$LogPath) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Executable @Arguments *>&1 | Out-File -LiteralPath $LogPath -Encoding utf8
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    throw "$([IO.Path]::GetFileName($Executable)) failed with exit code $exitCode; details were suppressed to protect database contents and credentials."
  }
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

function Get-FileSha256([string]$Path) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try {
    $bytes = $sha256.ComputeHash($stream)
    return [BitConverter]::ToString($bytes).Replace('-', '')
  } finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
}

function Get-TreeManifest([string]$Directory) {
  $base = [IO.Path]::GetFullPath($Directory).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $manifest = @(
    Get-ChildItem -LiteralPath $Directory -File -Recurse | ForEach-Object {
      $relative = $_.FullName.Substring($base.Length).Replace('\', '/')
      $hash = Get-FileSha256 $_.FullName
      "$relative`t$($_.Length)`t$hash"
    } | Sort-Object
  )
  return ,$manifest
}

$requiredPaths = @($EnvironmentFile, $AgeExe, $AgeKeygenExe, $McExe, $PgDump, $PgRestore, $PgCtl, $PgIsReady, $InitDb, $Psql)
foreach ($path in $requiredPaths) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required local backup tool is missing: $path" }
}

$environmentText = [IO.File]::ReadAllText($EnvironmentFile)
$dbName = Get-EnvironmentValue "POSTGRES_DB" $environmentText
$dbUser = Get-EnvironmentValue "POSTGRES_USER" $environmentText
$dbPassword = Get-EnvironmentValue "POSTGRES_PASSWORD" $environmentText
$dbPort = [int](Get-EnvironmentValue "LOCAL_POSTGRES_PORT" $environmentText)
$bucket = Get-EnvironmentValue "MINIO_BUCKET" $environmentText
$endpoint = Get-EnvironmentValue "MINIO_ENDPOINT" $environmentText
$rootUser = Get-EnvironmentValue "MINIO_ROOT_USER" $environmentText
$rootPassword = Get-EnvironmentValue "MINIO_ROOT_PASSWORD" $environmentText
if ($dbPort -lt 1024 -or $dbPort -gt 65535) { throw "LOCAL_POSTGRES_PORT is outside the TCP port range." }
if ($endpoint -notmatch '^https?://') { $endpoint = "http://$endpoint" }
if (-not (Test-Path -LiteralPath $AgeExe -PathType Leaf)) {
  $ageCommand = Get-Command age.exe -ErrorAction SilentlyContinue
  if ($ageCommand) { $AgeExe = $ageCommand.Source }
}
if (-not (Test-Path -LiteralPath $AgeKeygenExe -PathType Leaf)) {
  $ageKeygenCommand = Get-Command age-keygen.exe -ErrorAction SilentlyContinue
  if ($ageKeygenCommand) { $AgeKeygenExe = $ageKeygenCommand.Source }
}

$workRoot = Join-Path $StoreRoot ("qa-tools/backup-restore-" + [guid]::NewGuid().ToString('N'))
$resolvedWorkRoot = [IO.Path]::GetFullPath($workRoot)
$resolvedStoreRoot = [IO.Path]::GetFullPath($StoreRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $resolvedWorkRoot.StartsWith($resolvedStoreRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Temporary QA path resolved outside the project-local ignored storage directory."
}

$payload = Join-Path $workRoot "payload"
$payloadMinio = Join-Path $payload "minio"
$scratchData = Join-Path $workRoot "restore-postgres"
$archive = Join-Path $workRoot "backup.tar.gz"
$encryptedArchive = Join-Path $workRoot "backup.tar.gz.age"
$decryptedArchive = Join-Path $workRoot "decrypted.tar.gz"
$extracted = Join-Path $workRoot "extracted"
$restoredBucketDir = Join-Path $workRoot "restored-minio"
$probeMirrorDir = Join-Path $workRoot "source-probe-mirror"
$identity = Join-Path $workRoot "age-identity.txt"
$probeFile = Join-Path $workRoot "restore-probe.txt"
$mcConfig = Join-Path $workRoot "mc-config"
$mcAlias = "backupcheck"
$probeSourceBucket = "backup-source-check-" + [guid]::NewGuid().ToString('N').Substring(0, 12)
$restoreBucket = "restore-check-" + [guid]::NewGuid().ToString('N').Substring(0, 12)
$scratchPort = 0
$scratchStarted = $false
$probeSourceBucketCreated = $false
$restoreBucketCreated = $false
$oldPassword = $env:PGPASSWORD
$oldMcConfig = $env:MC_CONFIG_DIR
$result = $null

try {
  New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
  $currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $icacls = Join-Path $env:WINDIR "System32/icacls.exe"
  Invoke-Checked $icacls @($workRoot, "/inheritance:r", "/grant:r", "*$($currentUserSid):(OI)(CI)F") (Join-Path $workRoot "secure-work-directory.log")
  New-Item -ItemType Directory -Path $payloadMinio, $mcConfig -Force | Out-Null
  $env:PGPASSWORD = $dbPassword
  $env:MC_CONFIG_DIR = $mcConfig

  & $PgIsReady -h 127.0.0.1 -p $dbPort -q
  if ($LASTEXITCODE -ne 0) { throw "Project PostgreSQL is not accepting connections on configured port $dbPort." }
  $health = Invoke-WebRequest -Uri "$endpoint/minio/health/ready" -TimeoutSec 5 -UseBasicParsing
  if ($health.StatusCode -ne 200) { throw "Project MinIO health endpoint did not return HTTP 200." }

  Invoke-Checked $AgeKeygenExe @("-o", $identity) (Join-Path $workRoot "age-keygen.log")
  Invoke-Checked $icacls @($identity, "/inheritance:r", "/grant:r", "*$($currentUserSid):F") (Join-Path $workRoot "secure-age-identity.log")
  $recipient = (& $AgeKeygenExe -y $identity 2> (Join-Path $workRoot "age-keygen-public.log") | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or $recipient -notmatch '^age1[0-9a-z]+$') { throw "Could not derive a temporary age recipient." }

  Invoke-Checked $PgDump @("-Fc", "-h", "127.0.0.1", "-p", "$dbPort", "-U", $dbUser, "-d", $dbName, "-f", (Join-Path $payload "database.dump")) (Join-Path $workRoot "pg-dump.log")
  Invoke-Checked $McExe @("alias", "set", $mcAlias, $endpoint, $rootUser, $rootPassword, "--api", "S3v4") (Join-Path $workRoot "mc-alias.log")
  Invoke-Checked $McExe @("mirror", "--overwrite", "$mcAlias/$bucket", $payloadMinio) (Join-Path $workRoot "mc-backup-mirror.log")

  $privateBucketObjectCount = (Get-TreeManifest $payloadMinio).Count
  Invoke-Checked $McExe @("mb", "--ignore-existing", "$mcAlias/$probeSourceBucket") (Join-Path $workRoot "mc-create-source-probe-bucket.log")
  $probeSourceBucketCreated = $true
  [IO.File]::WriteAllText($probeFile, "local encrypted backup restore probe`n", [Text.UTF8Encoding]::new($false))
  Invoke-Checked $McExe @("cp", $probeFile, "$mcAlias/$probeSourceBucket/probe.txt") (Join-Path $workRoot "mc-source-probe-upload.log")
  Invoke-Checked $McExe @("mirror", "--overwrite", "$mcAlias/$probeSourceBucket", $probeMirrorDir) (Join-Path $workRoot "mc-source-probe-mirror.log")
  $probeManifest = Get-TreeManifest $probeMirrorDir
  if ($probeManifest.Count -ne 1 -or (Get-FileSha256 (Join-Path $probeMirrorDir "probe.txt")) -ne (Get-FileSha256 $probeFile)) {
    throw "MinIO source bucket probe did not mirror with the expected content."
  }
  $archiveProbeDir = Join-Path $payloadMinio "__backup_restore_probe__"
  New-Item -ItemType Directory -Path $archiveProbeDir -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $probeMirrorDir "probe.txt") -Destination (Join-Path $archiveProbeDir "probe.txt") -Force
  Invoke-Checked $McExe @("rb", "--force", "$mcAlias/$probeSourceBucket") (Join-Path $workRoot "mc-remove-source-probe-bucket.log")
  $probeSourceBucketCreated = $false

  $sourceManifest = Get-TreeManifest $payloadMinio
  $archivedMinioObjectCount = $sourceManifest.Count
  $tarExe = Join-Path $env:WINDIR "System32/tar.exe"
  if (-not (Test-Path -LiteralPath $tarExe -PathType Leaf)) { $tarExe = (Get-Command tar.exe -ErrorAction Stop).Source }
  Invoke-Checked $tarExe @("-czf", $archive, "-C", $payload, "database.dump", "minio") (Join-Path $workRoot "tar-create.log")
  Invoke-Checked $AgeExe @("--recipient", $recipient, "--output", $encryptedArchive, $archive) (Join-Path $workRoot "age-encrypt.log")
  Invoke-Checked $AgeExe @("--decrypt", "--identity", $identity, "--output", $decryptedArchive, $encryptedArchive) (Join-Path $workRoot "age-decrypt.log")
  $archiveHash = Get-FileSha256 $archive
  $decryptedHash = Get-FileSha256 $decryptedArchive
  if ($archiveHash -ne $decryptedHash) { throw "Decrypted backup archive does not match the original archive." }

  New-Item -ItemType Directory -Path $extracted -Force | Out-Null
  Invoke-Checked $tarExe @("-xzf", $decryptedArchive, "-C", $extracted) (Join-Path $workRoot "tar-extract.log")
  if (-not (Test-Path -LiteralPath (Join-Path $extracted "database.dump") -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $extracted "minio") -PathType Container)) {
    throw "Decrypted archive is missing the expected database.dump or minio tree."
  }
  $extractedManifest = Get-TreeManifest (Join-Path $extracted "minio")
  if (($sourceManifest -join "`n") -cne ($extractedManifest -join "`n")) { throw "Encrypted archive object tree does not match the source mirror." }

  foreach ($candidate in 55400..59999) {
    if (Test-LocalPortAvailable $candidate) { $scratchPort = $candidate; break }
  }
  if ($scratchPort -eq 0) { throw "No free loopback port was available for the isolated PostgreSQL restore." }
  Invoke-Checked $InitDb @("-D", $scratchData, "--username=restorecheck", "--auth=trust", "--encoding=UTF8", "--no-locale") (Join-Path $workRoot "initdb.log")
  & $PgCtl -D $scratchData -l (Join-Path $workRoot "restore-postgres.log") -o "-h 127.0.0.1 -p $scratchPort -c timezone=UTC" -w start
  $pgStartExit = $LASTEXITCODE
  if ($pgStartExit -ne 0) { throw "Temporary PostgreSQL failed to start; diagnostics were suppressed to protect project data." }
  $scratchStarted = $true
  Invoke-Checked $PgRestore @("--exit-on-error", "--no-owner", "--no-privileges", "-h", "127.0.0.1", "-p", "$scratchPort", "-U", "restorecheck", "-d", "postgres", (Join-Path $extracted "database.dump")) (Join-Path $workRoot "pg-restore.log")
  $tableCountOutput = & $Psql -h 127.0.0.1 -p $scratchPort -U restorecheck -d postgres -Atqc "SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public';" 2> (Join-Path $workRoot "pg-verify.log")
  if ($LASTEXITCODE -ne 0 -or [int]$tableCountOutput -lt 1) { throw "PostgreSQL restore did not produce the expected application schema." }

  Invoke-Checked $McExe @("mb", "--ignore-existing", "$mcAlias/$restoreBucket") (Join-Path $workRoot "mc-create-restore-bucket.log")
  $restoreBucketCreated = $true
  Invoke-Checked $McExe @("mirror", "--overwrite", (Join-Path $extracted "minio"), "$mcAlias/$restoreBucket") (Join-Path $workRoot "mc-restore-upload.log")
  Invoke-Checked $McExe @("mirror", "--overwrite", "$mcAlias/$restoreBucket", $restoredBucketDir) (Join-Path $workRoot "mc-restore-download.log")

  $expectedManifest = Get-TreeManifest (Join-Path $extracted "minio")
  $restoredManifest = Get-TreeManifest $restoredBucketDir
  if (($expectedManifest -join "`n") -cne ($restoredManifest -join "`n")) { throw "Restored MinIO object tree does not match the archive." }

  $result = [PSCustomObject]@{
    Result = "passed"
    PostgreSQLPublicTables = [int]$tableCountOutput
    OriginalPrivateBucketObjects = $privateBucketObjectCount
    SyntheticArchiveProbeObjects = $probeManifest.Count
    ArchivedMinioObjects = $archivedMinioObjectCount
    RestoredMinioObjects = $restoredManifest.Count
    EncryptionRoundTrip = "passed"
    ScratchPostgresPort = $scratchPort
  }
} finally {
  $cleanupPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if ($scratchStarted) {
      & $PgCtl -D $scratchData -m fast -w stop *> (Join-Path $workRoot "restore-pg-stop.log")
    }
    if ($probeSourceBucketCreated) {
      & $McExe "--config-dir" $mcConfig rb --force "$mcAlias/$probeSourceBucket" *> (Join-Path $workRoot "mc-cleanup-source-bucket.log")
    }
    if ($restoreBucketCreated) {
      & $McExe "--config-dir" $mcConfig rb --force "$mcAlias/$restoreBucket" *> (Join-Path $workRoot "mc-cleanup-bucket.log")
    }
  } finally {
    $env:PGPASSWORD = $oldPassword
    $env:MC_CONFIG_DIR = $oldMcConfig
    if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
    $ErrorActionPreference = $cleanupPreference
  }
}

$result
