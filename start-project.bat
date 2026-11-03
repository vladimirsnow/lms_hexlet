@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Kzhexly College LMS launcher

set "LAN_IP=127.0.0.1"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-ip.ps1`) do set "LAN_IP=%%I"
set "APP_URL=http://%LAN_IP%:3000"

echo Checking whether Kzhexly LMS is already running...
call :check_site
if errorlevel 20 goto port_busy
if errorlevel 11 goto open_local_existing
if errorlevel 10 goto open_existing

if not exist ".env" goto missing_env
where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_npm
if not exist "node_modules\next\dist\bin\next" goto missing_dependencies
if not exist ".local-services\postgres\runtime\pgsql\bin\pg_ctl.exe" goto missing_postgres

echo Starting local PostgreSQL...
call npm run db:local:start
if errorlevel 1 goto launch_failed

echo Generating the database client...
call npm run prisma:generate
if errorlevel 1 goto launch_failed

echo Applying pending database migrations...
call npm run db:deploy
if errorlevel 1 goto launch_failed

echo Seeding system settings...
call npm run db:seed
if errorlevel 1 goto launch_failed

if exist ".local-services\object-storage\minio-build\bin\minio.exe" if exist ".local-services\object-storage\minio-build\bin\mc.exe" goto minio_ready
echo Building the local MinIO runtime for the first launch...
call npm run storage:local:build
if errorlevel 1 goto launch_failed

:minio_ready
echo Starting local MinIO storage...
call npm run storage:local:start
if errorlevel 1 goto launch_failed

echo Starting local ClamAV scanner...
call npm run clamav:local:start
if errorlevel 1 goto launch_failed

set "SEO_INDEXING_ENABLED=false"

if exist ".next\BUILD_ID" goto use_standard_build
goto use_dev_server

:use_standard_build
set "NEXT_DIST_DIR=.next"
echo Starting the production build. Its window will stay open for logs.
start "Kzhexly LMS" /D "%CD%" cmd /k "call npm run start -- --hostname 0.0.0.0 --port 3000"
goto start_worker

:use_dev_server
set "NEXT_DIST_DIR="
echo No production build was found; starting the development server.
start "Kzhexly LMS" /D "%CD%" cmd /k "call npm run dev -- --hostname 0.0.0.0 --port 3000"

:start_worker
start "Kzhexly Worker" /D "%CD%" cmd /k "call npm run worker"
echo Waiting for the health check...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=[DateTime]::UtcNow.AddSeconds(90); while ([DateTime]::UtcNow -lt $deadline) { try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 2; if ($health.status -eq 'ok') { exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 1"
if errorlevel 1 goto health_failed

echo LMS is ready at %APP_URL%
start "" "%APP_URL%"
exit /b 0

:check_site
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 2; if ($health.status -eq 'ok') { try { $lanHealth=Invoke-RestMethod -Uri '%APP_URL%/api/v1/health' -TimeoutSec 2; if ($lanHealth.status -eq 'ok') { exit 10 } } catch {}; exit 11 } } catch {}; if (Test-NetConnection -ComputerName '127.0.0.1' -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 20 }; exit 0"
exit /b %errorlevel%

:open_existing
echo Kzhexly LMS is already running. Opening it in your browser.
start "" "%APP_URL%"
exit /b 0

:open_local_existing
echo Kzhexly LMS is running only on this computer. Opening the local address.
start "" "http://127.0.0.1:3000"
exit /b 0

:port_busy
echo Port 3000 is occupied by a service that did not pass the LMS health check.
echo Close that service or change its port before launching Kzhexly LMS.
pause
exit /b 1

:missing_env
echo The .env file is missing. Copy .env.example to .env and set local secrets first.
pause
exit /b 1

:missing_node
echo Node.js is not installed or is not available in PATH.
pause
exit /b 1

:missing_npm
echo npm is not available in PATH. Repair or reinstall Node.js.
pause
exit /b 1

:missing_dependencies
echo Project dependencies are missing. Run npm ci from this folder first.
pause
exit /b 1

:missing_postgres
echo The local PostgreSQL runtime is missing. Follow the setup steps in docs\09-infrastructure.md.
pause
exit /b 1

:launch_failed
echo A startup command failed. Read the output above, then close this window.
pause
exit /b 1

:health_failed
echo The server did not become healthy within 90 seconds.
echo Check the Kzhexly LMS and Kzhexly Worker windows for error messages.
pause
exit /b 1
