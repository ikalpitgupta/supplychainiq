# SupplyChainIQ

**Fashion E-commerce Supply Chain Intelligence** — a full-stack decision-support platform that converts sales, inventory, supplier, and purchase-order data into demand-spike alerts, stock-out risk, delivery performance insights, and actionable replenishment decisions for a fashion marketplace (Myntra-style assortment).

> **The business journey: DEMAND → INVENTORY → FULFILLMENT → DELIVERY → RETURNS → ROOT CAUSE → RECOMMENDATION → BUSINESS IMPACT.**
> Every chart answers a business question, every KPI is computed live from the database, and every recommendation explains *why*.

---

## 1. Product Overview

SupplyChainIQ answers the six questions a category/ops team at a fashion e-commerce company faces every morning:

1. **What is happening?** — live KPIs, demand trend, health score
2. **Where is the problem?** — which SKUs, categories, suppliers, orders
3. **Why is it happening?** — explainable math behind every flag (z-scores, reorder points, lead-time projections)
4. **What will happen next?** — backtested forecasts, stock-out projections, scenario simulation
5. **What should the business do?** — ranked actions with quantities, suppliers, and timing
6. **What is the expected impact?** — revenue at risk, excess capital, holding cost, price-variance impact

It is not a CRUD inventory app. The system continuously analyses demand history, current stock, demand variability, supplier delivery performance, and the purchase-order pipeline, then surfaces:

- **Risk alerts** — which styles will stock out *before replenishment can arrive*, and which are tying up working capital.
- **Forecasts** — explainable daily demand forecasts with confidence intervals and backtested accuracy metrics.
- **Recommendations** — every product mapped to one of six actions (`NO ACTION`, `MONITOR`, `REORDER SOON`, `ORDER NOW`, `REDUCE FUTURE ORDERS`, `REVIEW SUPPLIER`) with quantity, supplier, and a plain-language reason.
- **Delivery intelligence** — inbound on-time performance, lead-time drift, and late-order accountability by supplier.
- **Returns exposure** — an honest view of what a returns ledger would surface first (see Limitations).

## 2. Business Problem

A fashion e-commerce company loses money in two symmetric ways:

- **Stock-outs** — lost sales and marketplace ranking when demand outpaces replenishment (the order arrives *after* stock hits zero). Fashion demand is weekend-heavy and spike-prone — a festive-season surge of +30% on a hero SKU can break a naive min-level policy.
- **Overstock** — cash locked in slow-moving styles (last season's inventory), plus holding costs (~20% of unit cost per year in the demo assumptions). Size-and-style assortment breadth makes fashion especially exposed.

Both failures come from the same blind spot: the gap between *how long stock lasts* and *how long replenishment takes*. SupplyChainIQ makes that gap visible per SKU and turns it into a decision.

## 3. Key Features

| Area (nav) | What you get |
|---|---|
| **Command Center** | 6 live KPIs with period deltas, health score with component breakdown, demand-vs-forecast chart (7d/30d/90d/12m), anomaly-aware insights, critical alerts, top actions, dynamically generated executive summary; operational + executive views |
| **Inventory** | Search, category/status/supplier filters, sorting, pagination, CSV export; clicking the health donut filters the table |
| **Demand Forecast** | Product/category selection, 7/30/90-day horizons, confidence intervals, backtested MAE/RMSE/MAPE, method disclosure |
| **Fulfillment** | Purchase-order lifecycle management: statuses, guided create form with live stock context, supplier-linked pipeline — the upstream half of the journey |
| **Delivery** | Inbound supplier delivery performance: on-time rate, average lead time, average delay, monthly delivery rhythm, late-order accountability, inbound pipeline, purchase-price integrity |
| **Returns** | Honest data-gap disclosure plus return-*exposure* bands per top-selling line (clearly labeled indicative benchmarks, never fabricated rates) and links to the upstream drivers already tracked |
| **Suppliers** | Transparent weighted scoring (delivery 30 / quality 25 / cost 25 / reliability 20) with per-component breakdown, trend charts, auto-generated summary |
| **Insights & Actions** | The decision center: recommendations grouped Critical / Warning / Opportunity, priority score + confidence per recommendation, supplier review flags, one-click "Create Purchase Order" |
| **Scenario Lab** | What-if sliders (demand ±, lead time, safety stock, inventory) driving live backend recalculation; save and compare scenarios side by side |
| **Intelligence** | Inventory efficiency (turnover, DIO, holding cost), fulfillment efficiency, supplier spend concentration (HHI), single-source dependencies, purchase-price variance with annualized impact, inventory aging (0-30/31-60/61-90/90+), velocity matrix, slow movers, ABC×XYZ segmentation with strategy notes, data-generated insights |
| **Data Quality** | 8-rule validation scan (missing values, duplicates, invalid dates, negative quantities, impossible transitions, missing suppliers/categories, outlier prices) with a 0-100 score and per-issue drill-down |
| **Global search** | Ctrl+K command palette: products, suppliers, pages, and quick actions with keyboard navigation |
| **Data I/O** | CSV/XLSX import (products/sales/inventory/suppliers) with row-level validation, CSV export for all entities |
| **Settings** | Service level, lead-time, safety-stock, ordering/holding cost assumptions; reset demo data; UI preferences |

## 4. Architecture

```
frontend/                    React 18 + TypeScript + Vite + Tailwind
  src/api/                   Typed API client (token auth, error normalization)
  src/components/ui/         Hand-rolled shadcn-style component kit
  src/components/charts/     Recharts wrappers (business-question titles built in)
  src/hooks/                 Auth, toasts, filters, TanStack Query data hooks
  src/pages/                 15 routed pages + 404 (business-journey nav order)
  src/utils/                 Formatting (₹, %, days) + CSV/XLSX import engine

backend/                     FastAPI + Pydantic v2 + SQLAlchemy 2.0
  app/api/routes/            REST endpoints (auth, dashboard, products, suppliers,
                             purchase-orders, fulfillment/returns, recommendations,
                             analytics, data-quality, intelligence, settings, import/export)
  app/models/                SQLAlchemy models (9 tables)
  app/schemas/               Pydantic request validation
  app/services/              Business logic layer (dashboard, products, recommendations,
                             suppliers, purchase orders, fulfillment+returns, analytics,
                             anomaly, control tower, intelligence, scenario, import/export,
                             settings)
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
categories(id, name)                    -- Fashion, Footwear, Beauty, Accessories,
                                        -- Bags & Luggage, Sportswear, Home & Living,
                                        -- Personal Care
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

Seed data is a **fashion-first assortment**: 8 categories, 15 apparel/footwear/beauty suppliers, 96 SKUs, one year of daily demand with weekend and festive-season uplift, and a signature hero SKU — *Festive Kurta Set* — whose deterministic path produces the marquee demo: a +30% festive demand spike that stocks the item out in 8 days against a 10-day lead time → CRITICAL → ORDER NOW, with a pre-selected supplier and EOQ-sized quantity. All classifications are still computed at runtime by the analytics layer; nothing downstream knows the seed pinned anything.

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
| On-time rate | `delivered on-or-before expected ÷ delivered` | purchase-order based (inbound delivery) |

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

_Add screenshots here: Command Center KPIs, inventory health donut, forecast chart with CI band, Delivery on-time trend, supplier score breakdown, Insights & Actions cards, ABC×XYZ segmentation._

## 12. Roadmap (later phases)

- **Returns ledger** (phase 2): a `returns` table (RMA, reason code, disposition, resale state) powering measured return rates, reason Pareto, and return-aware reorder math — the current Returns page is the honest placeholder that will be replaced.
- **Outbound delivery tracking**: courier/3PL integration feed for customer-side delivery promises.
- Seasonality-aware forecasting (SARIMA / Prophet) with holiday regressors
- Interactive data explorer + natural-language question panel backed by a controlled query grammar
- Real JWT + role-based access control
- Email/Slack digest of critical recommendations
- Multi-echelon inventory transfers between warehouses

## Business Value

> The business journey this platform implements:
> **DEMAND → INVENTORY → FULFILLMENT → DELIVERY → RETURNS → ROOT CAUSE → RECOMMENDATION → BUSINESS IMPACT**

- **Reduce stock-outs** — reorder points are computed from *actual* demand variability and supplier lead times, so orders trigger before the shortfall, not after the shelf is empty. The engine projects stock at the lead-time date, catching the "will run out in 8 days" case a naive min-level rule misses.
- **Reduce excess inventory** — overstock detection via days-of-inventory against a configurable policy horizon, plus zero-demand flagging, keeps working capital from parking in last season's styles.
- **Improve supplier selection** — a transparent weighted score (delivery 30%, quality 25%, cost 25%, reliability 20%) with per-component breakdowns replaces gut feel; the recommendation engine attaches the preferred supplier to every order.
- **Hold suppliers accountable for delivery** — the Delivery page turns late POs into named accountability and a monthly rhythm view, feeding both supplier reviews and stock-out prevention.
- **Improve procurement decisions** — EOQ with configurable cost assumptions balances ordering vs holding cost, and the create-PO flow warns when the entered quantity won't cover the replenishment cycle.
- **Improve demand planning** — backtested forecasts with disclosed methods and accuracy metrics (MAE/RMSE/MAPE) make planning assumptions auditable rather than anecdotal.
- **Reduce inventory carrying costs** — ABC×XYZ analysis focuses monitoring effort on the SKUs that dominate consumption value, and Intelligence quantifies holding cost against turnover.

## API Summary

```
POST /api/auth/login            GET  /api/health
GET  /api/dashboard?period=90&category=
GET  /api/meta/categories
GET  /api/products              GET  /api/products/{id}
GET  /api/forecasts/{product_id}?horizon=30
GET  /api/suppliers             GET  /api/suppliers/{id}
GET  /api/purchase-orders       POST /api/purchase-orders
PUT  /api/purchase-orders/{id}
GET  /api/fulfillment/summary?period_days=90
GET  /api/returns/summary
GET  /api/recommendations
GET  /api/data-quality
GET /api/intelligence/control-tower
GET /api/intelligence/anomalies?kind=demand
GET /api/intelligence/scenarios/{product_id}?demand_pct=25&lead_delta=5
GET /api/intelligence/scenarios/{product_id}/cost-curve
GET /api/intelligence/abc-xyz  GET  /api/intelligence/inventory-aging
GET /api/intelligence/velocity-matrix  GET  /api/intelligence/slow-movers
GET /api/intelligence/procurement-intelligence
GET  /api/analytics
GET  /api/settings              PUT  /api/settings
POST /api/settings/reset-demo   (admin)
POST /api/import/{entity}       GET  /api/export/{entity}
```

All mutating endpoints validate via Pydantic; errors return `{"message": ...}` with appropriate status codes and never leak stack traces.

## Limitations (honest scope)

- **Returns are not measured.** The demo data model has no returns ledger; the Returns page states this explicitly and shows exposure bands derived from published category benchmarks, not fabricated records.
- **Delivery is inbound.** Without a courier/3PL feed, "Delivery" means supplier delivery performance against purchase orders — the tractable, data-backed half of the delivery story.
- Authentication is a signed demo token (no real JWT provider or RBAC); SQLite fallback unless Docker Postgres is started.
