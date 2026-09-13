# One-click production launcher: build + serve + public URL.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start_prod.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# 1. Build frontend if dist is missing or stale
$dist = Join-Path $root "frontend\dist\index.html"
$needsBuild = -not (Test-Path $dist)
if (-not $needsBuild) {
  $newestSrc = Get-ChildItem (Join-Path $root "frontend\src") -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newestSrc.LastWriteTime -gt (Get-Item $dist).LastWriteTime) { $needsBuild = $true }
}
if ($needsBuild) {
  Write-Host "Building frontend..."
  Push-Location (Join-Path $root "frontend")
  npx vite build
  Pop-Location
}

# 2. Restart backend on :8000 (serves API + built frontend)
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","cd /d $(Join-Path $root 'backend') && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > ..\.freebuff\prod-server.log 2>&1" -WindowStyle Hidden

# 3. Wait for health
$ok = $false
foreach ($i in 1..30) {
  Start-Sleep -Seconds 1
  try { $h = Invoke-RestMethod "http://localhost:8000/api/health" -TimeoutSec 2; if ($h.status -eq "ok") { $ok = $true; break } } catch {}
}
if (-not $ok) { Write-Host "Backend failed to start - check .freebuff\prod-server.log"; exit 1 }
Write-Host "App running on http://localhost:8000"

# 4. Public tunnel (prints URL)
& (Join-Path $PSScriptRoot "tunnel.ps1")
