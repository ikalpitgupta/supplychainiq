# ---- Stage 1: build the frontend ----
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
# API base is relative (/api) and the backend serves these files, so no env needed.
RUN npm run build

# ---- Stage 2: python runtime serving API + static frontend ----
FROM python:3.13-slim
WORKDIR /app

# Dependency layer first for cache efficiency
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

WORKDIR /app/backend

# Render/other hosts inject $PORT; default to 8000 locally.
ENV PORT=8000 \
    PYTHONUNBUFFERED=1

EXPOSE 8000
# Auto-seed runs inside the app lifespan on an empty database.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
