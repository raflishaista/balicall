@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo   Bali Tower Voice Call & AI Minutes Environment
echo ========================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please download and install Node.js (v18+ or v20+) from:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: 2. Check and copy server/.env
if not exist "server\.env" (
    echo [*] Setting up server\.env from template...
    if exist "server\.env.example" (
        copy "server\.env.example" "server\.env" >nul
        echo [OK] Created server\.env. Edit it later to set your LLM_KEY if needed.
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

:: 4. Check server dependencies
if not exist "server\node_modules" (
    echo [*] Installing backend dependencies (express, livekit-server-sdk, etc.)...
    pushd server
    call npm install
    popd
    echo [OK] Backend dependencies installed!
)

:: 5. Check client dependencies
if not exist "client\node_modules" (
    echo [*] Installing client dependencies (react, livekit-client, etc.)...
    pushd client
    call npm install
    popd
    echo [OK] Client dependencies installed!
)

echo.
echo ========================================================
echo   All requirements verified! Launching services...
echo ========================================================
echo.

:: Launch 1: SFU Server
echo [1/3] Starting LiveKit SFU Server (Port 7880)...
start "LiveKit SFU" cmd /k "bin\livekit-server.exe --dev"
timeout /t 2 >nul

:: Launch 2: Backend Server
echo [2/3] Starting Backend Server (Port 3001)...
start "Backend Server" cmd /k "cd server && npm run dev"
timeout /t 2 >nul

:: Launch 3: PC Client
echo [3/3] Starting PC Web Client (Port 5173)...
start "PC Client" cmd /k "cd client && npm run dev"

echo.
echo All services launched!
echo Open your browser at: http://localhost:5173
echo ========================================================
pause
