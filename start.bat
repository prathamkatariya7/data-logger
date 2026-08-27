@echo off
REM ============================================================
REM  Data Logger - build + launch (Windows)
REM  Double-click this file to install deps, build the UI,
REM  and start the server on the LAN.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo(
echo ============================================
echo   Data Logger - starting up
echo ============================================
echo(

REM --- 1. Backend dependencies ---
if not exist "node_modules" (
  echo [1/3] Installing backend dependencies...
  call npm install || goto :fail
) else (
  echo [1/3] Backend dependencies present - skipping.
)

REM --- 2. Frontend dependencies + build ---
if not exist "frontend\node_modules" (
  echo [2/3] Installing frontend dependencies...
  call npm --prefix frontend install || goto :fail
)
echo [2/3] Building frontend...
call npm --prefix frontend run build || goto :fail

REM --- 3. Detect LAN IP so you know the shareable link ---
set "LAN_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\lan-ip.ps1"`) do set "LAN_IP=%%i"
if "%LAN_IP%"=="" set "LAN_IP=<this-laptop-LAN-IP>"

if not defined PORT set "PORT=8080"

echo(
echo ============================================
echo   Server starting...
echo(
echo   On this laptop:   http://localhost:%PORT%
echo   Share this link:  http://%LAN_IP%:%PORT%
echo(
echo   (Anyone on the same WiFi can open the shared link.)
echo   Press Ctrl+C to stop.
echo ============================================
echo(

REM --- 4. Launch (binds 0.0.0.0 so LAN devices can reach it) ---
node server.js
goto :eof

:fail
echo(
echo *** Build/launch failed. See the messages above. ***
pause
exit /b 1
