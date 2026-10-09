@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="--models" goto models
if /i "%~1"=="--live" goto live
echo ========================================================
echo   BaliCall Local Whisper STT Server (faster-whisper)
echo ========================================================
echo.

:: Default to small (CTranslate2 INT8 quantized, fast on CPU)
set MODEL=small
if not "%~1"=="" set MODEL=%~1

echo [*] Model: %MODEL%
echo [*] Endpoint: http://127.0.0.1:8000/v1/audio/transcriptions
echo.
echo [*] Press Ctrl+C to stop the server.
echo.

python scripts\whisper_server.py --model "%MODEL%" --host 127.0.0.1 --port 8000
pause
exit /b

:models
if not exist "server\speech\.venv\Scripts\python.exe" (
    echo [ERROR] Create server\speech\.venv and install requirements.txt first.
    exit /b 1
)
echo [*] Multi-model STT: http://127.0.0.1:8001/v1/audio/transcriptions
echo [*] Configure STT_BASE_URL for port 8001 and advertise only installed model aliases.
pushd "server\speech"
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8001
set "WHISPER_EXIT=%ERRORLEVEL%"
popd
exit /b %WHISPER_EXIT%

:live
powershell -NoProfile -ExecutionPolicy Bypass -File "server\speech\start-live.ps1"
exit /b %ERRORLEVEL%
