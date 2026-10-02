@echo off
echo ========================================================
echo Starting Bali Tower Voice Call Base Environment...
echo ========================================================
echo 1. Starting LiveKit SFU Server (Port 7880)...
start "LiveKit SFU" cmd /k "bin\livekit-server.exe --dev"
timeout /t 2 >nul

echo 2. Starting Backend Server (Port 3001)...
start "Backend Server" cmd /k "cd server && npm run dev"
timeout /t 2 >nul

echo 3. Starting PC Web Client (Port 5173)...
start "PC Client" cmd /k "cd client && npm run dev"

echo.
echo All services launched!
echo Open your browser at: http://localhost:5173
echo ========================================================
pause
