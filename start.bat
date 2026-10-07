@echo off
setlocal enabledelayedexpansion

:: Ensure script runs from its own directory
cd /d "%~dp0"

echo ========================================================
echo   Bali Tower Voice Call, Video ^& AI Workspace
echo ========================================================
echo.

:: 1. Run setup checks if setup.ps1 exists
if exist "scripts\setup.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup.ps1"
    if errorlevel 1 (
        echo [WARNING] Setup script reported issues. Continuing with direct launch...
    )
)

:: 2. Ensure server/.env exists
if not exist "server\.env" (
    echo [*] Setting up server\.env from template...
    if exist "server\.env.example" (
        copy "server\.env.example" "server\.env" >nul
        echo [OK] Created server\.env.
    )
)

:: 3. Check LiveKit SFU binary
if not exist "bin\livekit-server.exe" (
    echo [*] LiveKit SFU binary not found in bin\
    echo [*] Automatically downloading LiveKit Server for Windows...
    powershell -Command "New-Item -ItemType Directory -Force -Path 'bin' | Out-Null; $zip='bin\livekit.zip'; Write-Host 'Downloading...'; Invoke-WebRequest -Uri 'https://github.com/livekit/livekit/releases/download/v1.13.7/livekit_1.13.7_windows_amd64.zip' -OutFile $zip; Write-Host 'Extracting...'; Expand-Archive -Path $zip -DestinationPath 'bin' -Force; Remove-Item $zip -Force"
    if exist "bin\livekit-server.exe" (
        echo [OK] LiveKit Server downloaded successfully!
    ) else (
        echo [WARNING] Could not auto-download LiveKit. Please check your internet connection.
    )
)

:: 4. Ensure dependencies are installed
if not exist "server\node_modules" (
    echo [*] Installing backend dependencies...
    pushd "%~dp0server"
    call npm install
    popd
)

if not exist "client\node_modules" (
    echo [*] Installing client dependencies...
    pushd "%~dp0client"
    call npm install
    popd
)

echo.
echo ========================================================
echo   Launching BaliCall Services...
echo ========================================================
echo.

:: Launch 1: SFU Server (skip if Docker or another instance is already running)
netstat -ano | findstr ":7880" >nul
if errorlevel 1 (
    echo [1/3] Starting LiveKit SFU Server on Port 7880...
    if exist "livekit.yaml" (
        start "BaliCall LiveKit SFU" /D "%~dp0" cmd /k "bin\livekit-server.exe --config livekit.yaml --dev"
    ) else (
        start "BaliCall LiveKit SFU" /D "%~dp0" cmd /k "bin\livekit-server.exe --dev"
    )
    ping -n 3 127.0.0.1 >nul
) else (
    echo [1/3] Port 7880 is already in use [Docker or background SFU is active]. Skipping native launch.
)

:: Launch 2: Backend Server
echo [2/3] Starting Backend Server on Port 3001...
start "BaliCall Backend" /D "%~dp0server" cmd /k "npm run dev"
ping -n 3 127.0.0.1 >nul

:: Launch 3: Client Workspace
echo [3/3] Starting PC Web Client on Port 5187...
start "BaliCall Client" /D "%~dp0client" cmd /k "npm run dev"

echo.
echo ========================================================
echo   All services launched!
echo   Open your browser at: http://127.0.0.1:5187
echo ========================================================
pause
endlocal
