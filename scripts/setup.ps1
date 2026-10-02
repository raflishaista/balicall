param([switch]$SkipLiveKitDownload)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js is missing. Install Node 24 LTS (minimum 22.18).'
    }
    $nodeVersion = [version]((node --version).TrimStart('v'))
    if ($nodeVersion -lt [version]'22.18.0') { throw 'Node 22.18 or newer is required. Recommended: Node 24 LTS.' }
    if (-not (Test-Path -LiteralPath 'server/.env')) {
        Copy-Item -LiteralPath 'server/.env.example' -Destination 'server/.env'
        Write-Host 'Created server/.env. Configure STT and LLM separately when available.'
    }
    $binaryPath = Join-Path $projectRoot 'bin/livekit-server.exe'
    if (-not $SkipLiveKitDownload -and -not (Test-Path -LiteralPath $binaryPath)) {
        New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'bin') | Out-Null
        $assetName = 'livekit_1.13.7_windows_amd64.zip'
        $releaseBase = 'https://github.com/livekit/livekit/releases/download/v1.13.7'
        $archivePath = Join-Path $projectRoot 'bin/livekit.zip'
        $checksumPath = Join-Path $projectRoot 'bin/livekit.checksums.txt'
        Write-Host 'Downloading official LiveKit v1.13.7 release...'
        if (-not (Test-Path -LiteralPath $archivePath)) {
            Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$assetName" -OutFile $archivePath
        }
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/checksums.txt" -OutFile $checksumPath
        $checksums = Get-Content -LiteralPath $checksumPath -Raw
        $checksumLine = ($checksums -split "`n" | Where-Object { $_ -match [regex]::Escape($assetName) })
        if (-not $checksumLine) { throw 'Official release checksum was not found.' }
        $expectedHash = (($checksumLine.Trim() -split '\s+')[0]).ToUpperInvariant()
        $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
        if ($expectedHash -ne $actualHash) {
            Remove-Item -LiteralPath $archivePath
            throw 'LiveKit download checksum mismatch. Run setup again to download a fresh archive.'
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
        try {
            $binaryEntry = $archive.Entries | Where-Object { $_.Name -eq 'livekit-server.exe' } | Select-Object -First 1
            if (-not $binaryEntry) { throw 'The official archive contains no livekit-server.exe.' }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($binaryEntry, $binaryPath, $true)
            $licenseEntry = $archive.Entries | Where-Object { $_.Name -eq 'LICENSE' } | Select-Object -First 1
            if ($licenseEntry) {
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($licenseEntry, (Join-Path $projectRoot 'bin/livekit-LICENSE.txt'), $true)
            }
        } finally { $archive.Dispose() }
        Remove-Item -LiteralPath $archivePath
        Remove-Item -LiteralPath $checksumPath
        if (-not (Test-Path -LiteralPath $binaryPath)) { throw 'The LiveKit binary was not found after extraction.' }
    }
    foreach ($packageDirectory in @('server', 'client')) {
        if (-not (Test-Path -LiteralPath "$packageDirectory/node_modules")) {
            Write-Host "Installing $packageDirectory dependencies..."
            npm --prefix $packageDirectory ci
            if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed for $packageDirectory." }
        }
    }
    Write-Host 'Setup complete. Run npm run sfu, npm run server, and npm run client.'
} finally {
    Pop-Location
}
