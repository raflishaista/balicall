@echo off
setlocal
cd /d "%~dp0"
echo Preparing BaliCall...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup.ps1"
if errorlevel 1 (
  echo Setup failed. Review the error above before starting the services.
  pause
  exit /b 1
)
start "BaliCall LiveKit" cmd /k "npm run sfu"
start "BaliCall Backend" cmd /k "npm run server"
start "BaliCall Client" cmd /k "npm run client"
echo Open http://127.0.0.1:5187 after the client is ready.
endlocal
