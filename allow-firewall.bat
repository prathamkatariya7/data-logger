@echo off
REM ============================================================
REM  Allow other devices on the WiFi to reach the Data Logger.
REM  RUN THIS ONCE, as Administrator (right-click > Run as administrator).
REM  Opens inbound TCP 3000 in Windows Firewall.
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo This must be run as Administrator.
  echo Right-click allow-firewall.bat and choose "Run as administrator".
  pause
  exit /b 1
)

set "PORT=8080"
netsh advfirewall firewall delete rule name="Data Logger %PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="Data Logger %PORT%" dir=in action=allow protocol=TCP localport=%PORT%

echo(
echo Done. Inbound TCP %PORT% is now allowed.
echo Others on the same WiFi can reach http://<this-laptop-LAN-IP>:%PORT%
pause
