$ErrorActionPreference = 'Stop'
$speechRoot = $PSScriptRoot
$projectRoot = Split-Path (Split-Path $speechRoot -Parent) -Parent
$workerEnv = Join-Path $speechRoot '.env.qwen'
if (Test-Path -LiteralPath $workerEnv) {
    foreach ($line in Get-Content -LiteralPath $workerEnv) {
        if ($line -match '^(QWEN_PYTHON_PATH|QWEN_PORT|QWEN_MODEL_PATH|QWEN_LOCAL_FILES_ONLY|QWEN_DTYPE|QWEN_CPU_THREADS|SPEECH_DEVICE)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"').Trim("'"), 'Process')
        }
    }
}
$pythonPath = if ($env:QWEN_PYTHON_PATH) { $env:QWEN_PYTHON_PATH } else { Join-Path $speechRoot '.venv-qwen/Scripts/python.exe' }
if (!(Test-Path -LiteralPath $pythonPath)) {
    throw 'Create server/speech/.venv-qwen and install qwen_requirements.txt first.'
}
$workerPort = if ($env:QWEN_PORT) { [int]$env:QWEN_PORT } else { 8006 }
if (Get-NetTCPConnection -State Listen -LocalPort $workerPort -ErrorAction SilentlyContinue) {
    throw "Port $workerPort is already in use. Check the existing Qwen worker before starting another."
}
$serverEnv = Join-Path $projectRoot 'server/.env'
if (Test-Path -LiteralPath $serverEnv) {
    $keyLine = Get-Content -LiteralPath $serverEnv | Where-Object { $_ -match '^QWEN_STT_API_KEY=' } | Select-Object -First 1
    if ($keyLine) { $env:SPEECH_API_KEY = $keyLine.Substring('QWEN_STT_API_KEY='.Length).Trim().Trim('"').Trim("'") }
}
$env:HF_HOME = Join-Path $speechRoot 'models/hf-cache'
if (!$env:SPEECH_DEVICE) { $env:SPEECH_DEVICE = 'cpu' }
if (!$env:QWEN_CPU_THREADS) { $env:QWEN_CPU_THREADS = '4' }
if (!$env:QWEN_DTYPE) { $env:QWEN_DTYPE = if ($env:SPEECH_DEVICE -eq 'cpu') { 'float32' } else { 'float16' } }
$logRoot = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$worker = Start-Process -FilePath $pythonPath -ArgumentList '-m','uvicorn','qwen_app:app','--host','127.0.0.1','--port',"$workerPort" -WorkingDirectory $speechRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'local-qwen.out.log') -RedirectStandardError (Join-Path $logRoot 'local-qwen.err.log') -PassThru
Write-Output "Qwen worker launched (PID $($worker.Id)). Model loading may take time; check http://127.0.0.1:$workerPort/health for ready=true."
