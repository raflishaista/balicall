@echo off
cd /d "%~dp0"
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

python scripts\whisper_server.py --model %MODEL% --port 8000
pause
