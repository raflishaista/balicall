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
        echo [OK] LiveKit Server downloaded successfully.
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

if not exist "client\node_modules\ldrs" (
    echo [*] Updating client dependencies...
    pushd "%~dp0client"
    call npm install
    popd
)

echo.
echo ========================================================
echo   Launching BaliCall Services...
echo ========================================================
echo.

:: Launch 1: SFU Server (LiveKit WebRTC)
netstat -ano -p tcp | findstr ":7880 " | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [1/4] Starting LiveKit SFU Server on Port 7880...
    if exist "livekit.yaml" (
        start "BaliCall LiveKit SFU" /D "%~dp0" cmd /k "bin\livekit-server.exe --config livekit.yaml --dev"
    ) else (
        start "BaliCall LiveKit SFU" /D "%~dp0" cmd /k "bin\livekit-server.exe --dev"
    )
    ping -n 3 127.0.0.1 >nul
) else (
    echo [1/4] Port 7880 is already active [LiveKit SFU].
)

:: Launch 2: Local Whisper STT + Nemotron-3 Diarization Server
netstat -ano -p tcp | findstr ":8001 " | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [2/4] Starting Local Whisper STT + Diarization Server on Port 8001...
    start "BaliCall Whisper STT" /D "%~dp0" cmd /k "start_whisper.bat"
    ping -n 3 127.0.0.1 >nul
) else (
    echo [2/4] Port 8001 is already active [Whisper STT Server].
)

:: Launch 3: Backend Server
netstat -ano -p tcp | findstr ":3001 " | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [3/4] Starting Backend Server on Port 3001...
    start "BaliCall Backend" /D "%~dp0server" cmd /k "node index.js"
    ping -n 3 127.0.0.1 >nul
) else (
    echo [3/4] Port 3001 is already active [Backend Server].
)

:: Launch 4: Client Workspace
netstat -ano -p tcp | findstr ":5187 " | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [4/4] Starting PC Web Client on Port 5187...
    start "BaliCall Client" /D "%~dp0client" cmd /k "npm run dev"
    ping -n 3 127.0.0.1 >nul
) else (
    echo [4/4] Port 5187 is already active [Web Client].
)

echo.
echo ========================================================
echo   All BaliCall services are up and running!
echo.
echo   [1] Web Client  : http://localhost:5187 (or http://127.0.0.1:5187)
echo   [2] Backend API : http://127.0.0.1:3001
echo   [3] LiveKit SFU : ws://127.0.0.1:7880
echo   [4] Whisper STT : http://127.0.0.1:8001
echo ========================================================
echo.
echo [*] Opening browser at http://localhost:5187 ...
start http://localhost:5187
echo.
pause
endlocal
