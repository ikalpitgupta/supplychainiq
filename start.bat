@echo off
REM SupplyChainIQ - one-command local startup (Windows).
REM Requires: Python 3.11+, Node 18+.

echo == SupplyChainIQ ==

echo ==^> Installing backend dependencies (if needed)...
python -m pip install --user -q -r backend\requirements.txt

echo ==^> Installing frontend dependencies (if needed)...
pushd frontend
call npm install --no-audit --no-fund --silent
popd

echo ==^> Seeding database (deterministic demo data)...
pushd backend
python ..\scripts\seed_database.py
popd

echo ==^> Starting backend on http://localhost:8000 ...
start "SupplyChainIQ backend" cmd /c "cd backend && python -m uvicorn app.main:app --port 8000"

echo ==^> Waiting for backend health...
powershell -NoProfile -Command "for($i=0;$i -lt 20;$i++){ try { Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8000/api/health -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep 1 } }"

echo ==^> Starting frontend on http://localhost:5173 ...
cd frontend
call npm run dev
