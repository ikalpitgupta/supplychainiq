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
| **Command Center** | 6 live KPIs with period deltas, health score with component breakdown, demand-vs-forecast chart (7d/30d/90d/12m), anomaly-aware insights, interactive root-cause chain (demand → inventory imbalance → distant routing → SLA breach, every hop measured), customer-impact strip (late deliveries ↔ cancellations/returns), critical alerts, top actions, dynamically generated executive summary |
| **Inventory** | Search, category/status/supplier filters, sorting, pagination, CSV export; clicking the health donut filters the table; product pages add a size × warehouse availability matrix with color-coded cells |
| **Demand Forecast** | Product/category selection, 7/30/90-day horizons, confidence intervals, backtested MAE/RMSE/MAPE, method disclosure |
| **Fulfillment** | Purchase-order lifecycle management: statuses, guided create form with live stock context, supplier-linked pipeline; plus **outbound bottleneck intelligence** — pick → pack → dispatch cycle split, the identified bottleneck stage, and per-warehouse comparison from 15k+ customer orders |
| **Delivery** | Inbound supplier delivery performance (on-time rate, lead times, late-order accountability) plus **outbound SLA intelligence**: on-time rate, late rate by region / warehouse / carrier, and delay-reason mix — where are delivery SLAs breaking? |
| **Returns** | Measured from the outbound order book: overall return rate, reason Pareto, category split (sized vs one-size), most-returned products with measured rates, disposition mix, and the ops→CX linkage (late deliveries ↔ cancellations) |
| **Size Availability Risk** | Per-product size-level stock-out detection: a size is flagged when its stock share falls below its demand share or its cover drops under recent offtake — "XL is approaching stock-out", with revenue at risk |
| **Root Cause Analysis** | The flagship *"don't just tell me the metric changed"* engine: detectors surface material now-vs-prior movements, then each problem is investigated through a hypothesis tree (inventory availability → warehouse allocation → fulfillment stages → carrier performance → regional mix → demand volume). Every branch is measured on the same window basis and ranked by how much of the movement it arithmetically accounts for. Causal language is disciplined — *associated with / likely contributor / potential contributor / requires investigation* — and "primary driver" is claimed only when a single factor's decomposition reproduces the movement. Interactive tree; clicking a node reveals its supporting metrics |
| **Interview Demo Mode** | `/demo` — the complete PM thinking flow in 2–3 minutes, told from the live database: problem detection (regional SLA deterioration, animated now-vs-prior counters) → investigation (availability → allocation → fulfillment chain reveal) → customer impact (late → cancellations → revenue at risk, every figure labeled Actual/Estimated) → recommendation → scenario simulation (the live network engine with the pre-positioning lever; honestly notes what does NOT move) → impact × confidence × effort → control/variant experiment design with real sample sizes → Ship/Iterate/Reject with criteria, ending on "From Data → Insight → Decision → Impact". Nothing scripted: re-seed and the story re-tells whatever the data then says |
| **Product Intelligence** | Grounded AI layer (`/api/pi/*`) — a PM analytics tool, not a chatbot. **Ask**: insight explanation (what changed → evidence → possible drivers → recommendation → KPIs → suggested experiment → confidence with data-quality basis). **Validate**: supporting evidence / potential risks / missing information / suggested KPI + experiment for any recommendation. **Experiments**: designs on measured baselines with two-proportion sample sizes (α=0.05, 80% power). **Executive summary**: analytics in business language with a "what this environment does not measure" disclosure. The analytics layer owns every number: answers are composed deterministically from a grounds packet, an optional LLM pass (OPENAI/ANTHROPIC key) may only polish prose under a no-new-numbers rule, insufficient data gets the honest refusal, and tests enforce the no-invented-numbers contract |
| **Suppliers** | Transparent weighted scoring (delivery 30 / quality 25 / cost 25 / reliability 20) with per-component breakdown, trend charts, auto-generated summary |
| **Inbound Intelligence** | Four lenses on one page — **Procurement** (supplier risk linkage: measured PO on-time/defect joined to downstream stock-out and overstock exposure, spend concentration HHI), **Catalog Quality** (attribute completeness by category with the size-chart ↔ returns linkage stated only when measured on both sides), **Pricing** (high-discount/low-margin products, observed unit movement after price changes — correlation, never causation), **Promotions** (campaign → orders → revenue → margin with discount cost and an organic baseline; the trade-off is explicit, e.g. a 40% campaign running at an 11% margin rate vs 47% organic) |
| **Insights & Actions** | The decision center: recommendations grouped Critical / Warning / Opportunity, priority score + confidence per recommendation, supplier review flags, one-click "Create Purchase Order" — plus the **PM decision layer**: every major insight converted into a structured product initiative (customer-framed problem → opportunity sizing → RICE prioritization with impact/effort quadrants → experiment design with real sample-size math → Ship / Experiment / Reject decision with criteria → business impact with explicit trade-offs). One initiative is deliberately *rejected* because the RCA bottleneck data refutes its premise — the gate cuts both ways |
| **Scenario Lab** | Business-level what-if engine (`/api/scenarios/network`): demand shock, supplier lead slip, home-DC allocation, service level, promotion uplift + discount depth, warehouse capacity — every animated stage is a real intermediate of the server-side calculation (demand → safety stock → requirement → stock-out → fulfillment load → SLA blend → revenue at risk → working capital → recommended action), with Current vs Scenario A vs Scenario B comparison. Single-product simulator retained on a second tab. |
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
warehouses(id, code, name, region, city)              -- outbound fulfillment nodes
variant_inventory(id, product_id→products, warehouse_id→warehouses, size, color,
                  units)                               -- Black/M/Delhi = 12
outbound_orders(id, product_id→products, warehouse_id→warehouses, region, size,
                quantity, unit_price, revenue, order_date, promised_date,
                pick/pack/dispatch_hours, carrier, status, delay_reason,
                delivered_date)                        -- 90d customer order book
return_lines(id, order_id→outbound_orders, product_id→products, reason,
             disposition, return_date)
users(id, name, email, role)
settings(key, value, kind, label)   -- runtime business assumptions
```

Seed data is a **fashion-first assortment**: 8 categories, 15 apparel/footwear/beauty suppliers, 96 SKUs, one year of daily demand with weekend and festive-season uplift, and a signature hero SKU — *Festive Kurta Set* — whose deterministic path produces the marquee demo: a +30% festive demand spike that stocks the item out in 8 days against a 10-day lead time → CRITICAL → ORDER NOW, with a pre-selected supplier and EOQ-sized quantity. All classifications are still computed at runtime by the analytics layer; nothing downstream knows the seed pinned anything.

The **outbound layer** makes the INVENTORY → FULFILLMENT → DELIVERY → RETURNS story real: 4 regional DCs (North/South/East/West), ~1,100 size × color × warehouse variant rows with a *designed* imbalance (the South DC is deliberately under-stocked), 90 days of customer orders (~15k) with pick/pack/dispatch timings, carrier mix, cancellations, and delay reasons — including distant-DC routing that demonstrably produces higher late rates — plus a returns ledger with reason codes and dispositions. The causal chain in the data is genuine: thin South-DC stock → distant routing → longer dispatch → SLA breach, and the root-cause card can only show the chain when the window's numbers actually support it.

The **inbound layer** powers Inbound Intelligence: catalog attributes on every product (color, material, description, images, size chart, MRP, price-change history) with a deterministic slice of gaps for the quality scan, and three promotion campaigns inside the outbound window with attributed discounted orders — so conversion, discount cost, and margin impact are all derived from rows, never asserted.

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

## 10. Deploy (free)

The whole app ships as **one container**: FastAPI serves the API and the built frontend on the same origin (the frontend uses relative `/api` paths, so no CORS or env wiring needed). Auto-seed on first boot means a fresh database becomes a fully working demo with no manual step.

### Which free host?

| Host | Card needed | Expires | Sleeps | Config |
|---|---|---|---|---|
| **ClawCloud Run** (recommended) | No (GitHub ≥180 days) | Never — $5/mo credit | **No** — always on | Any Docker host |
| Koyeb | Usually no | Never | Scale-to-zero | `koyeb.yaml` included |
| Render | No | Never | ~15 min idle → ~50 s wake | `render.yaml` included |
| Back4App Containers | No | Never (600 h/mo) | Auto-sleep on idle | Any Docker host |

Every option here redeploys automatically on `git push`. CI (`.github/workflows/ci.yml`) runs tests **and a full Docker image build** on every push, so a deploy-breaking change is caught before you deploy.

### ClawCloud Run (recommended — always on, no cold start)

1. Sign up at [run.claw.cloud](https://run.claw.cloud) with GitHub (account must be ≥180 days old for the monthly $5 credit).
2. **Launch → App** → connect the repo.
3. Container settings: **port `8000`**, CPU 1 / RAM 1 GB is plenty. The `$PORT` env is honored automatically.
4. Deploy — the free $5/mo credit covers one small always-on instance, so the demo **never sleeps** (no 50-second cold starts during an interview).

### Koyeb (never expires, no card)

1. Sign up at [koyeb.com](https://www.koyeb.com) with GitHub.
2. **Create Web Service** → GitHub → select this repo.
3. Koyeb detects the `Dockerfile` and `koyeb.yaml` → **Deploy**.

### Render (one-click blueprint)

1. Go to [render.com](https://render.com) → **New → Blueprint** → select the repo.
2. Render reads `render.yaml` and provisions the service. Done.

### Persistence on either host

The in-container SQLite fallback works forever but is ephemeral (resets on redeploy/sleep-wake). Point `DATABASE_URL` at a free external Postgres — [Neon](https://neon.tech) or [Supabase](https://supabase.com), both never expire — format: `postgresql+psycopg2://user:pass@host/db`.

### Docker (any host)

```bash
docker build -t supplychainiq .
docker run -p 8000:8000 -e PORT=8000 supplychainiq
# → http://localhost:8000 (frontend + API)
```

## 11. Demo Credentials

| Email | Password | Role |
|---|---|---|
| admin@supplychainiq.com | admin123 | admin (can reset demo data) |
| manager@supplychainiq.com | manager123 | manager |

Authentication issues a signed demo token (JWT-shaped); the auth layer is isolated in `backend/app/core/security.py` so a real JWT provider can replace it without touching routes.

## 11. Screenshots

_Add screenshots here: Command Center KPIs, inventory health donut, forecast chart with CI band, Delivery on-time trend, supplier score breakdown, Insights & Actions cards, ABC×XYZ segmentation._

## 12. Roadmap (later phases)

- **3PL integration feed**: push courier/webhook delivery events into `outbound_orders` to replace the seeded delay-reason mix.
- Returns dispositions workflow (refund/replace/exchange state machine) on top of the shipped returns ledger
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
GET  /api/outbound/summary
GET  /api/outbound/size-availability?category=&limit=12
GET  /api/outbound/fulfillment-bottleneck?days=30
GET  /api/outbound/delivery-sla?days=30
GET  /api/outbound/root-cause?days=30
GET  /api/outbound/customer-impact?days=30
GET  /api/outbound/actions?days=30
GET  /api/outbound/returns?days=90
GET  /api/inbound/summary
GET  /api/inbound/procurement?days=120
GET  /api/inbound/catalog-quality
GET  /api/inbound/pricing?days=90
GET  /api/inbound/promotions?days=90
GET  /api/rca/analysis?days=21
GET  /api/rca/problems?days=21
GET  /api/pm/decisions
GET  /api/analytics
GET  /api/settings              PUT  /api/settings
POST /api/settings/reset-demo   (admin)
POST /api/import/{entity}       GET  /api/export/{entity}
```

All mutating endpoints validate via Pydantic; errors return `{"message": ...}` with appropriate status codes and never leak stack traces.

## Limitations (honest scope)

- **Outbound data is simulated, but causal.** The customer-order book and returns ledger are seeded (no live 3PL/courier feed), yet every number shown is *computed* from those rows and the designed causal structure (stock imbalance → distant routing → SLA breach) is verifiable in the data itself. The root-cause card displays the chain only when the window's evidence supports it.
- Authentication is a signed demo token (no real JWT provider or RBAC); SQLite fallback unless Docker Postgres is started.
