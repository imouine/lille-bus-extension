# Lille Bus Extension - Chrome Web Store Packaging Script
# Creates a clean .zip of the src/ folder ready for CWS upload.
# Usage:  .\scripts\package.ps1
# Output: dist\lille-bus-extension-v{version}.zip

$ErrorActionPreference = "Stop"

$root    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$srcDir  = Join-Path $root "src"
$distDir = Join-Path $root "dist"

$manifest = Get-Content (Join-Path $srcDir "manifest.json") -Raw | ConvertFrom-Json
$version  = $manifest.version

Write-Host ""
Write-Host "  Lille Bus Extension - Packaging" -ForegroundColor Cyan
Write-Host "  Version: $version" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

$zipName = "lille-bus-extension-v$version.zip"
$zipPath = Join-Path $distDir $zipName

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Write-Host "  Zipping src/ ..." -ForegroundColor Yellow
Compress-Archive -Path (Join-Path $srcDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

$sizeKB = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)

Write-Host ""
Write-Host "  Done! $zipName - $sizeKB KB" -ForegroundColor Green
Write-Host "  $zipPath" -ForegroundColor Gray
Write-Host ""
