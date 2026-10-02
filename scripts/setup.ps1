Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   Setting up Bali Tower Voice Call Environment" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Check Node
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed! Please install Node.js (https://nodejs.org/)"
    exit 1
}

# 2. Check .env
if (-not (Test-Path "server\.env")) {
    Write-Host "[*] Creating server\.env from template..." -ForegroundColor Yellow
    Copy-Item "server\.env.example" "server\.env"
}

# 3. Check LiveKit Server
if (-not (Test-Path "bin\livekit-server.exe")) {
    Write-Host "[*] Downloading LiveKit SFU server binary..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "bin" | Out-Null
    $zip = "bin\livekit.zip"
    Invoke-WebRequest -Uri "https://github.com/livekit/livekit/releases/download/v1.13.7/livekit_1.13.7_windows_amd64.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath "bin" -Force
    Remove-Item $zip -Force
    Write-Host "[OK] LiveKit Server binary ready in bin\" -ForegroundColor Green
}

# 4. Install server dependencies
if (-not (Test-Path "server\node_modules")) {
    Write-Host "[*] Installing backend dependencies (server/)..." -ForegroundColor Yellow
    npm --prefix server install
}

# 5. Install client dependencies
if (-not (Test-Path "client\node_modules")) {
    Write-Host "[*] Installing frontend dependencies (client/)..." -ForegroundColor Yellow
    npm --prefix client install
}

Write-Host "`n[SUCCESS] Setup complete! You can now run .\start.bat or npm run sfu / server / client" -ForegroundColor Green
