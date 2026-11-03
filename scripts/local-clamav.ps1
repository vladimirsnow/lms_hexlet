param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("start", "stop", "status", "update")]
  [string]$Action
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot ".local-services/clamav"
$versionRoot = Join-Path $runtimeRoot "bin/clamav-1.4.6.win.x64"
$clamd = Join-Path $versionRoot "clamd.exe"
$clamscan = Join-Path $versionRoot "clamscan.exe"
$freshclam = Join-Path $versionRoot "freshclam.exe"
$database = Join-Path $runtimeRoot "database"
$freshclamConfig = Join-Path $runtimeRoot "freshclam.conf"
$clamdConfig = Join-Path $runtimeRoot "clamd.conf"
$pidFile = Join-Path $runtimeRoot "clamd.pid"
$logFile = Join-Path $runtimeRoot "clamd.log"
$port = 3310
$configuredPort = [Environment]::GetEnvironmentVariable("CLAMAV_PORT")
if (-not $configuredPort) {
  $envFile = Join-Path $projectRoot ".env"
  if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    $portLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*CLAMAV_PORT\s*=' } | Select-Object -First 1
    if ($portLine) {
      $configuredPort = ($portLine -replace '^\s*CLAMAV_PORT\s*=\s*', '').Trim().Trim('"').Trim("'")
    }
  }
}
if ($configuredPort) {
  $parsedPort = 0
  if (-not [int]::TryParse($configuredPort, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
    throw "CLAMAV_PORT must be an integer between 1 and 65535."
  }
  $port = $parsedPort
}
$script:listenerInspectionFallback = $false

function Test-LocalPortAvailable([int]$Port) {
  $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
  try {
    $probe.Start()
    return $true
  } catch {
    return $false
  } finally {
    $probe.Stop()
  }
}

function Test-ClamdPing([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $client.ReceiveTimeout = 1000
    $client.SendTimeout = 1000
    $client.Connect("127.0.0.1", $Port)
    $stream = $client.GetStream()
    [byte[]]$ping = @(0x7A, 0x50, 0x49, 0x4E, 0x47, 0x00)
    $stream.Write($ping, 0, $ping.Length)
    $stream.Flush()
    [byte[]]$buffer = New-Object byte[] 16
    $received = 0
    while ($received -lt $buffer.Length) {
      $count = $stream.Read($buffer, $received, $buffer.Length - $received)
      if ($count -le 0) { break }
      $received += $count
      if ([Array]::IndexOf($buffer, [byte]0, 0, $received) -ge 0) { break }
    }
    if ($received -eq 0) { return $false }
    $reply = [Text.Encoding]::ASCII.GetString($buffer, 0, $received).Trim([char[]]@(0, 10, 13))
    return $reply -eq "PONG"
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-ProjectClamdProcess {
  if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { return $null }
  $processId = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$processId)) { return $null }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process -or $process.ProcessName -ne "clamd") { return $null }
  try {
    if ([string]::Equals((Resolve-Path -LiteralPath $process.Path).Path, (Resolve-Path -LiteralPath $clamd).Path, [StringComparison]::OrdinalIgnoreCase)) {
      return $process
    }
  } catch { return $null }
  return $null
}

function Assert-LocalRuntime {
  if (-not (Test-Path -LiteralPath $clamd -PathType Leaf) -or
      -not (Test-Path -LiteralPath $freshclam -PathType Leaf)) {
    throw "Portable ClamAV is missing. Follow the Windows dev-only installation steps in docs/09-infrastructure.md."
  }
}

function Write-LocalConfigs {
  New-Item -ItemType Directory -Force -Path $database | Out-Null
  $freshclamLines = @(
    "DatabaseMirror database.clamav.net",
    "DNSDatabaseInfo current.cvd.clamav.net",
    "ConnectTimeout 60",
    "ReceiveTimeout 300",
    "MaxAttempts 3",
    "Checks 24",
    "ScriptedUpdates yes"
  )
  $clamdLines = @(
    "DatabaseDirectory `"$database`"",
    "LogFile `"$logFile`"",
    "LogTime yes",
    "TCPSocket $port",
    "TCPAddr 127.0.0.1",
    "StreamMaxLength 100M",
    "MaxFileSize 100M",
    "MaxScanSize 120M",
    "MaxRecursion 16",
    "MaxDirectoryRecursion 20"
  )
  Set-Content -LiteralPath $freshclamConfig -Value $freshclamLines -Encoding ascii
  Set-Content -LiteralPath $clamdConfig -Value $clamdLines -Encoding ascii
}

function Get-LocalListener {
  try {
    return Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop |
      Select-Object -First 1
  } catch {
    # Get-NetTCPConnection can be denied by restricted Windows environments because it queries CIM.
    # Try netstat as a fallback; its socket table may also be restricted by the environment.
    $script:listenerInspectionFallback = $true
    $netstat = Join-Path $env:SystemRoot "System32\netstat.exe"
    if (-not (Test-Path -LiteralPath $netstat -PathType Leaf)) {
      throw "Could not inspect the local ClamAV port: Get-NetTCPConnection failed and netstat.exe is unavailable. $($_.Exception.Message)"
    }

    $escapedPort = [Regex]::Escape([string]$port)
    foreach ($line in (& $netstat -ano -p TCP)) {
      if ($line -match "^\s*TCP\s+127\.0\.0\.1:$escapedPort\s+0\.0\.0\.0:0\s+\S+\s+(?<pid>\d+)\s*$") {
        return [pscustomobject]@{
          LocalAddress  = "127.0.0.1"
          LocalPort     = $port
          State         = "Listen"
          OwningProcess = [int]$Matches.pid
        }
      }
    }

    return $null
  }
}

function Invoke-DatabaseUpdate {
  Assert-LocalRuntime
  Write-LocalConfigs
  Write-Host "Updating ClamAV signatures into the ignored local runtime folder..."
  & $freshclam "--config-file=$freshclamConfig" "--datadir=$database"
  if ($LASTEXITCODE -ne 0) {
    throw "freshclam failed with exit code $LASTEXITCODE."
  }
}

Push-Location $projectRoot
try {
  switch ($Action) {
    "update" {
      Invoke-DatabaseUpdate
    }
    "status" {
      Assert-LocalRuntime
      & $clamscan --version
      if ($LASTEXITCODE -ne 0) {
        throw "Could not read the portable ClamAV version (exit code $LASTEXITCODE)."
      }
      Get-ChildItem -LiteralPath $database -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "^(main|daily|bytecode)\.(cvd|cld)$" } |
        Select-Object Name, Length, LastWriteTime
      $listener = Get-LocalListener
      if ($listener) {
        $listenerProcess = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        if ($listenerProcess -and $listenerProcess.ProcessName -eq "clamd") {
          Write-Host "clamd is listening on 127.0.0.1:$port (PID $($listener.OwningProcess))."
        } else {
          $processName = if ($listenerProcess) { $listenerProcess.ProcessName } else { "unknown process" }
          Write-Host "Port 127.0.0.1:$port is occupied by $processName (PID $($listener.OwningProcess)); clamd is not confirmed running."
        }
      } elseif ($script:listenerInspectionFallback) {
        $clamdProcess = Get-ProjectClamdProcess
        if (Test-ClamdPing $port) {
          if ($clamdProcess) {
            Write-Host "Project clamd is running and responds to PING on 127.0.0.1:$port (PID $($clamdProcess.Id)); the restricted session hides the listener table."
          } else {
            Write-Host "A clamd-compatible daemon responds to PING on 127.0.0.1:$port, but its process owner cannot be confirmed."
          }
        } elseif (-not $clamdProcess -and (Test-LocalPortAvailable $port)) {
          Write-Host "clamd is stopped and port 127.0.0.1:$port is free (the restricted session hides its listener table)."
        } elseif ($clamdProcess) {
          Write-Host "Project clamd process exists (PID $($clamdProcess.Id)), but it does not respond to PING on 127.0.0.1:$port."
        } else {
          Write-Host "Port 127.0.0.1:$port is occupied, but its owner is hidden and it does not respond to ClamAV PING."
        }
      } else {
        Write-Host "clamd is stopped."
      }
    }
    "start" {
      Assert-LocalRuntime
      Write-LocalConfigs
      $requiredDatabases = @("main.cvd", "daily.cvd", "bytecode.cvd")
      $missing = @($requiredDatabases | Where-Object { -not (Test-Path -LiteralPath (Join-Path $database $_) -PathType Leaf) })
      if ($missing.Count -gt 0) {
        throw "ClamAV signature databases are missing ($($missing -join ', ')). Run npm run clamav:local:update first."
      }

      $listener = Get-LocalListener
      if (-not $listener -and $script:listenerInspectionFallback) {
        if (Test-ClamdPing $port) {
          $existingClamd = Get-ProjectClamdProcess
          if ($existingClamd) {
            Write-Host "Project clamd is already running and responds to PING on 127.0.0.1:$port."
            break
          }
          throw "A clamd-compatible daemon already responds on 127.0.0.1:$port, but its owner cannot be confirmed."
        }
        if (-not (Test-LocalPortAvailable $port)) {
          throw "Port 127.0.0.1:$port is occupied, but the restricted Windows session cannot identify its owner. Refusing to start clamd."
        }
      }
      if ($listener) {
        $existing = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        if ($existing -and $existing.ProcessName -eq "clamd") {
          Write-Host "clamd is already listening on 127.0.0.1:$port."
          break
        }
        throw "Port 127.0.0.1:$port is already used by another process (PID $($listener.OwningProcess))."
      }

      $process = Start-Process -FilePath $clamd `
        -ArgumentList @("--foreground", "--config-file=`"$clamdConfig`"", "--pid=`"$pidFile`"") `
        -WindowStyle Hidden -PassThru
      $deadline = (Get-Date).AddMinutes(2)
      do {
        Start-Sleep -Milliseconds 500
        $process.Refresh()
        $listener = Get-LocalListener
        if (-not $listener -and $script:listenerInspectionFallback -and
            -not $process.HasExited -and (Test-ClamdPing $port)) {
          $startedProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
          if ($startedProcess -and $startedProcess.ProcessName -eq "clamd" -and
              [string]::Equals((Resolve-Path -LiteralPath $startedProcess.Path).Path, (Resolve-Path -LiteralPath $clamd).Path, [StringComparison]::OrdinalIgnoreCase)) {
            $listener = [pscustomobject]@{
              LocalAddress  = "127.0.0.1"
              LocalPort     = $port
              State         = "Listen"
              OwningProcess = $process.Id
            }
          }
        }
      } while (-not $listener -and -not $process.HasExited -and (Get-Date) -lt $deadline)

      if (-not $listener) {
        $logTail = Get-Content -LiteralPath $logFile -Tail 20 -ErrorAction SilentlyContinue
        $process.Refresh()
        if (-not $process.HasExited) {
          Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
          Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
          $startedPid = 0
          if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$startedPid) -and $startedPid -eq $process.Id) {
            Remove-Item -LiteralPath $pidFile -Force
          }
        }
        throw "clamd failed to listen on 127.0.0.1:$port. $($logTail -join "`n")"
      }
      Write-Host "clamd started on 127.0.0.1:$port (PID $($listener.OwningProcess)); the listener is loopback-only."
    }
    "stop" {
      if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
        Write-Host "clamd PID file is absent; nothing was stopped."
        break
      }
      $rawPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
      $clamdProcessId = 0
      if (-not [int]::TryParse($rawPid, [ref]$clamdProcessId)) {
        throw "The local ClamAV PID file is invalid. Remove only $pidFile after confirming clamd is stopped."
      }
      $process = Get-Process -Id $clamdProcessId -ErrorAction SilentlyContinue
      if (-not $process) {
        Remove-Item -LiteralPath $pidFile -Force
        Write-Host "Removed a stale local ClamAV PID file; no process was running."
        break
      }
      $processPath = $process.Path
      if ($process.ProcessName -ne "clamd" -or
          -not $processPath -or
          -not [string]::Equals($processPath, $clamd, [StringComparison]::OrdinalIgnoreCase)) {
        throw "PID $clamdProcessId does not resolve to this project's portable clamd.exe; refusing to stop it."
      }
      Stop-Process -Id $clamdProcessId -Force
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped project-local clamd PID $clamdProcessId."
    }
  }
} finally {
  Pop-Location
}
