#!/usr/bin/env bash
# SupplyChainIQ — one-command local startup (backend + frontend).
#
# Usage:
#   ./start.sh          # SQLite fallback mode (no Docker needed)
#
# Requires: Python 3.11+, Node 18+.
set -euo pipefail
cd "$(dirname "$0")"

echo "== SupplyChainIQ =="

# 1. Backend deps
echo "==> Installing backend dependencies (if needed)..."
python -m pip install --user -q -r backend/requirements.txt

# 2. Frontend deps
echo "==> Installing frontend dependencies (if needed)..."
(cd frontend && npm install --no-audit --no-fund --silent)

# 3. Seed database (uses SQLite fallback unless Postgres is running)
echo "==> Seeding database (deterministic demo data)..."
(cd backend && python ../scripts/seed_database.py)

# 4. Start backend
echo "==> Starting backend on http://localhost:8000 ..."
(cd backend && uvicorn app.main:app --port 8000 > ../backend.log 2>&1 &)

# 5. Wait for health
for i in $(seq 1 20); do
  if curl -sf --max-time 2 http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "    backend is healthy"
    break
  fi
  sleep 1
done

# 6. Start frontend
echo "==> Starting frontend on http://localhost:5173 ..."
(cd frontend && npm run dev)

echo
echo "Demo login: admin@supplychainiq.com / admin123"
