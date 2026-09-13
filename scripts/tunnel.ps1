# Expose the running app publicly via Cloudflare quick tunnel.
# Requires: backend running on :8000 (see start_prod.ps1), cloudflared downloaded.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root ".freebuff\cloudflared.exe"
if (-not (Test-Path $exe)) {
  Write-Host "Downloading cloudflared..."
  New-Item -ItemType Directory -Force -Path (Join-Path $root ".freebuff") | Out-Null
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $exe
}
# Stop any previous tunnel
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
$err = Join-Path $root ".freebuff\tunnel.err"
Start-Process -FilePath $exe -ArgumentList "tunnel","--url","http://localhost:8000","--no-autoupdate" -RedirectStandardOutput (Join-Path $root ".freebuff\tunnel.log") -RedirectStandardError $err -WindowStyle Hidden
$url = $null
foreach ($i in 1..20) {
  Start-Sleep -Seconds 1
  $match = Select-String -Path $err -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($match) { $url = $match.Matches[0].Value; break }
}
if ($url) { Write-Host "PUBLIC URL: $url" } else { Write-Host "Tunnel failed - check .freebuff\tunnel.err" }
