# SupplyChainIQ

**Supply Chain & Inventory Decision Support System** — a full-stack analytics platform that converts sales, inventory, supplier, and purchase-order data into risk alerts, forecasts, and actionable procurement recommendations.

> **The core loop: DATA → ANALYSIS → RISK → RECOMMENDATION → ACTION.**
> Every chart answers a business question, every KPI is computed live from the database, and every recommendation explains *why*.

---

## 1. Project Overview

SupplyChainIQ answers the four questions every procurement team faces:

1. **WHAT** should we order?
2. **WHEN** should we order it?
3. **HOW MUCH** should we order?
4. **FROM WHICH SUPPLIER** should we order?

It is not a CRUD inventory app. The system continuously analyses historical sales, current inventory, demand variability, supplier performance, and purchase orders, then surfaces:

- **Risk alerts** — which products will stock out *before replenishment can arrive*, and which are tying up working capital.
- **Forecasts** — explainable daily demand forecasts with confidence intervals and backtested accuracy metrics.
- **Recommendations** — every product mapped to one of six actions (`NO ACTION`, `MONITOR`, `REORDER SOON`, `ORDER NOW`, `REDUCE FUTURE ORDERS`, `REVIEW SUPPLIER`) with quantity, supplier, and a plain-language reason.
- **Analytics** — ABC/Pareto classification, turnover, procurement efficiency, and dynamically generated business insights.

## 2. Business Problem

A retail/e-commerce company loses money in two symmetric ways:

- **Stock-outs** — lost sales and customers when demand outpaces replenishment (the reorder arrives *after* stock hits zero).
- **Overstock** — cash locked in slow-moving inventory, plus holding costs (~20% of unit cost per year in the demo assumptions).

Both failures come from the same blind spot: the gap between *how long stock lasts* and *how long replenishment takes*. SupplyChainIQ makes that gap visible per SKU and turns it into a decision.

## 3. Key Features

| Area | What you get |
|---|---|
| Dashboard | 6 live KPIs with period-over-period deltas, interactive inventory-health mix, demand-vs-forecast chart (7d/30d/90d/12m), critical alerts, top recommendations, dynamically generated executive summary |
| Inventory | Search, category/status/supplier filters, sorting, pagination, CSV export; clicking the health chart filters the table |
| Product Details | SKU economics, inventory KPIs, 5 charts (stock level, demand history, forecast, inventory-vs-ROP, purchase history) |
| Demand Forecast | Product/category selection, 7/30/90-day horizons, confidence intervals, backtested MAE/RMSE/MAPE, method disclosure |
| Suppliers | Transparent weighted scoring (30/25/25/20) with per-component breakdown, trend charts, auto-generated summary |
| Purchase Orders | Full lifecycle statuses, create/update via API, guided create form with live stock context and low-quantity warning |
| Recommendations | Decision center grouped Critical / Warning / Opportunity, one-click "Create Purchase Order", priority score + confidence per recommendation |
| Control Tower | Live SUPPLIERS → PURCHASE ORDERS → WAREHOUSE → INVENTORY → CUSTOMERS flow with per-stage health, issue counts, and clickable drill-downs; single-source and concentration risks surfaced |
| Scenario Simulator | What-if sliders (demand ±, lead time, safety stock, inventory) driving live backend recalculation; save and compare scenarios side by side |
| Procurement IQ | Supplier spend & concentration, single-source dependency list, purchase-price variance with annualized impact, inventory aging (0-30/31-60/61-90/90+), slow movers, negotiation opportunities |
| Analytics | Inventory, procurement, sales, and efficiency sections; ABC×XYZ segmentation with strategy notes, velocity matrix, ABC Pareto; insights computed from data |
| Data Quality | 8-rule validation scan (missing values, duplicates, invalid dates, negative quantities, impossible transitions, missing suppliers/categories, outlier prices) with a 0-100 score and per-issue drill-down |
| Global search | Ctrl+K command palette: products, suppliers, pages, and quick actions with keyboard navigation |
| Data I/O | CSV import (products/sales/inventory/suppliers) with row-level validation, CSV export for all entities |
| Settings | Service level, lead-time, safety-stock, ordering/holding cost assumptions; reset demo data; UI preferences |

## 4. Architecture

```
frontend/                    React 18 + TypeScript + Vite + Tailwind
  src/api/                   Typed API client (token auth, error normalization)
  src/components/ui/         Hand-rolled shadcn-style component kit
  src/components/charts/     Recharts wrappers (business-question titles built in)
  src/hooks/                 Auth, toasts, filters, TanStack Query data hooks
  src/pages/                 14 routed pages + 404
  src/utils/                 Formatting (₹, %, days) + CSV templates

backend/                     FastAPI + Pydantic v2 + SQLAlchemy 2.0
  app/api/routes/            REST endpoints (auth, dashboard, products, suppliers,
                             purchase-orders, recommendations, analytics, data-quality,
                             intelligence, settings, import/export)
  app/models/                SQLAlchemy models (9 tables)
  app/schemas/               Pydantic request validation
  app/services/              Business logic layer (dashboard, products, recommendations,
                             suppliers, purchase orders, analytics, anomaly, control tower,
                             intelligence, scenario, import/export, settings)
  app/analytics/             Pure explainable engines (inventory math, forecasting,
                             EOQ, supplier scoring, ABC, segmentation, anomaly detection,
                             health score, procurement, scenario, impact)
  app/database/              Session management + deterministic seed
  tests/                     pytest: business logic + API integration

scripts/seed_database.py     CLI seeding entrypoint
docker-compose.yml           PostgreSQL 16 (optional; SQLite fallback built in)
```

**Database failover:** the backend always tries PostgreSQL first (via `DATABASE_URL`); if unreachable it transparently falls back to SQLite (`SQLITE_FALLBACK_URL`). The active engine is reported by `GET /api/health`.

## 5. Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Recharts, TanStack Query, Lucide icons, React Router
- **Backend**: Python 3.11+, FastAPI, Pydantic v2, SQLAlchemy 2.0, uvicorn
- **Analytics**: NumPy (+ scikit-learn optional for the GBM variant)
- **Database**: PostgreSQL 16 (Docker) with automatic SQLite fallback for zero-setup demos

## 6. Database Schema

```
categories(id, name)
suppliers(id, name, contact_email, lead_time_days, unit_cost, on_time_rate,
          defect_rate, reliability_score)
products(id, sku, name, category_id→categories, supplier_id→suppliers,
         unit_cost, selling_price, lead_time_days, active, created_at)
sales(id, product_id→products, sale_date, quantity, revenue, region)
inventory(id, product_id→products, date, opening_stock, received_quantity,
          sold_quantity, closing_stock)
purchase_orders(id, po_number, product_id→products, supplier_id→suppliers,
                quantity, unit_cost, order_date, expected_date, actual_date, status)
users(id, name, email, role)
settings(key, value, kind, label)   -- runtime business assumptions
```

Seed data is internally consistent: `opening_stock + received_quantity − sold_quantity = closing_stock` holds for every inventory row, and stock never goes negative.

## 7. Analytics Formulas

| Metric | Formula | Notes |
|---|---|---|
| Average daily demand | mean(units sold per day over `demand_window_days`) | window configurable in Settings |
| Days of inventory | `current_stock / avg_daily_demand` | zero demand → shown as "No recent demand", never divides by zero |
| Safety stock | `Z × σ_daily_demand × √lead_time_days` | Z from service level (95% → 1.65); protects against demand variability during replenishment |
| Reorder point | `avg_daily_demand × lead_time_days + safety_stock` | expected lead-time demand + buffer |
| Stock-out risk | High if projected stock at lead-time date < 0 or < safety stock; Medium if stock crosses safety level before arrival | projection: `current_stock − avg_daily_demand × lead_time_days` |
| EOQ | `√(2 × annual_demand × ordering_cost / holding_cost_per_unit)` | holding cost = `unit_cost × holding_cost_rate`; quantities below cycle cover are floored |
| Inventory turnover | `COGS / average inventory value` | period-matched |
| ABC class | cumulative share of annual consumption value (`annual_demand × unit_cost`) | A ≤ 80%, B ≤ 95%, C remainder; the item crossing a threshold belongs to the class it completes |
| Supplier score | `0.30×delivery + 0.25×quality + 0.25×cost + 0.20×reliability` | components min-max normalized across the supplier set, 0–100 |

All formulas are also surfaced in-app via "Why this matters" tooltips and the Settings page (marked **Demo Assumptions**).

## 8. Forecasting Methodology

Deliberately explainable — no black boxes:

1. **Candidates**: Moving Average (14d), Moving Average (28d), Exponential Smoothing (Holt's linear trend, damped).
2. **Backtest**: fit on all but the last *h* days, predict the tail, score each candidate by RMSE.
3. **Selection**: `auto` picks the backtest winner; the UI always discloses the chosen method (e.g. *"Forecast Method: Moving Average (28d)"*). Users can force a specific method, including an optional gradient-boosting variant.
4. **Confidence interval**: `ŷ ± 1.96 × residual std` from the backtest, floored to avoid degenerate zero-width bands.
5. **Accuracy metrics**: MAE, RMSE, MAPE computed on the held-out test window.

Forecasts are floored at zero and insufficient-data products (fewer than 14 days) return a clear "Insufficient data" state instead of a fabricated curve.

## 9. How to Run Locally

### Option A — one command (SQLite, no Docker)

```bash
./start.sh          # macOS/Linux
start.bat           # Windows
```

Then open **http://localhost:5173**.

### Option B — manual

```bash
# 1. Backend
pip install -r backend/requirements.txt

# 2. Seed (SQLite fallback is automatic when Postgres is absent)
python scripts/seed_database.py

# 3. Run API
cd backend && uvicorn app.main:app --port 8000

# 4. Frontend (new terminal)
cd frontend && npm install && npm run dev
```

### Option C — with PostgreSQL

```bash
docker compose up -d          # Postgres on localhost:5433
cp .env.example backend/.env
python scripts/seed_database.py
cd backend && uvicorn app.main:app --port 8000
cd frontend && npm run dev
```

### Tests

```bash
cd backend && python -m pytest tests/ -q      # 118 tests: formulas + APIs
cd frontend && npm test                       # 33 tests: formatting + CSV utils
```

## 10. Demo Credentials

| Email | Password | Role |
|---|---|---|
| admin@supplychainiq.com | admin123 | admin (can reset demo data) |
| manager@supplychainiq.com | manager123 | manager |

Authentication issues a signed demo token (JWT-shaped); the auth layer is isolated in `backend/app/core/security.py` so a real JWT provider can replace it without touching routes.

## 11. Screenshots

_Add screenshots here: dashboard KPIs, inventory health donut, forecast chart with CI band, supplier score breakdown, recommendation cards, ABC Pareto._

## 12. Future Improvements

- Seasonality-aware forecasting (SARIMA / Prophet) with holiday regressors
- Interactive data explorer + natural-language question panel ("Which products are at risk of stock-out?") backed by a controlled query grammar
- Real JWT + role-based access control
- Email/Slack digest of critical recommendations
- Multi-echelon inventory transfers between warehouses

## Business Value

> The business journey this platform implements:
> **DATA → MONITOR → DETECT → UNDERSTAND → FORECAST → SIMULATE → RECOMMEND → DECIDE → ACT → TRACK OUTCOME**

- **Reduce stock-outs** — reorder points are computed from *actual* demand variability and supplier lead times, so orders trigger before the shortfall, not after the shelf is empty. The engine projects stock at the lead-time date, catching the "will run out in 6 days" case a naive min-level rule misses.
- **Reduce excess inventory** — overstock detection via days-of-inventory against a configurable policy horizon, plus zero-demand flagging, keeps working capital from parking in slow SKUs.
- **Improve supplier selection** — a transparent weighted score (delivery 30%, quality 25%, cost 25%, reliability 20%) with per-component breakdowns replaces gut feel; the recommendation engine attaches the preferred supplier to every order.
- **Improve procurement decisions** — EOQ with configurable cost assumptions balances ordering vs holding cost, and the create-PO flow warns when the entered quantity won't cover the replenishment cycle.
- **Improve demand planning** — backtested forecasts with disclosed methods and accuracy metrics (MAE/RMSE/MAPE) make planning assumptions auditable rather than anecdotal.
- **Reduce inventory carrying costs** — ABC analysis focuses monitoring effort on the SKUs that dominate consumption value, and the analytics page quantifies holding cost against turnover.

## API Summary

```
POST /api/auth/login            GET  /api/health
GET  /api/dashboard?period=90&category=
GET  /api/products              GET  /api/products/{id}
GET  /api/forecasts/{product_id}?horizon=30
GET  /api/suppliers             GET  /api/suppliers/{id}
GET  /api/purchase-orders       POST /api/purchase-orders
PUT  /api/purchase-orders/{id}GET /api/recommendations       GET  /api/analytics
GET /api/data-quality
GET /api/intelligence/control-tower
GET /api/intelligence/anomalies?kind=demand
GET /api/intelligence/scenarios/{product_id}?demand_pct=25&lead_delta=5
GET /api/intelligence/scenarios/{product_id}/cost-curve
GET /api/intelligence/abc-xyz  GET  /api/intelligence/inventory-aging
GET /api/intelligence/velocity-matrix  GET  /api/intelligence/slow-movers
GET /api/intelligence/procurement-intelligence
GET  /api/settings              PUT  /api/settings
POST /api/settings/reset-demo   (admin)
POST /api/import/{entity}       GET  /api/export/{entity}
```

All mutating endpoints validate via Pydantic; errors return `{"message": ...}` with appropriate status codes and never leak stack traces.
