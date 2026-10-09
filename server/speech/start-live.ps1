$ErrorActionPreference = 'Stop'
$speechRoot = $PSScriptRoot
$projectRoot = Split-Path (Split-Path $speechRoot -Parent) -Parent
$pythonPath = Join-Path $speechRoot '.venv-live/Scripts/python.exe'
if (!(Test-Path -LiteralPath $pythonPath)) { throw 'Create .venv-live and install requirements-live.txt first.' }
$secretFile = Join-Path $speechRoot '.env.live'
if (!(Test-Path -LiteralPath $secretFile)) { throw 'Set LIVE_STT_SECRET in .env.live to the same secret as server/.env.' }
$secretLine = Get-Content -LiteralPath $secretFile | Where-Object { $_ -match '^LIVE_STT_SECRET=' } | Select-Object -First 1
$env:LIVE_STT_SECRET = $secretLine.Substring('LIVE_STT_SECRET='.Length)
$env:HF_HOME = Join-Path $speechRoot 'models/hf-cache'
$env:OMP_NUM_THREADS = '4'
$env:MKL_NUM_THREADS = '4'
$logRoot = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$worker = Start-Process -FilePath $pythonPath -ArgumentList '-m','uvicorn','live_app:app','--host','127.0.0.1','--port','8003','--ws-max-size','64000','--ws-max-queue','16','--no-access-log','--log-level','warning' -WorkingDirectory $speechRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'local-live.out.log') -RedirectStandardError (Join-Path $logRoot 'local-live.err.log') -PassThru
Write-Output "WhisperLiveKit started (PID $($worker.Id)), http://127.0.0.1:8003/health"
