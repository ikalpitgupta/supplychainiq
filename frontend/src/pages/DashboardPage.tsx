import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Boxes, CheckCircle2, ClipboardList, Gauge, IndianRupee,
  Package, RefreshCw, ShoppingCart, Target, TrendingUp, Truck,
} from "lucide-react";
import { dashboardApi, recommendationsApi } from "../api/endpoints";
import { useDashboardFilters } from "../hooks/useFilters";
import {
  Button, Card, CardBody, CardHeader, EmptyState, ErrorState, InfoTip, Select, SkeletonCard, Tabs,
} from "../components/ui";
import { KpiCard, PageHeader, SeverityBadge, StatusBadge } from "../components/shared";
import { HealthScoreCard } from "../components/shared/HealthScoreCard";
import { WhyModal } from "../components/shared/WhyModal";
import type { WhyStep } from "../components/shared/WhyModal";
import { DemandForecastChart, HealthDonut } from "../components/charts";
import { AnimatePresence, motion, Stagger, StaggerItem, useReducedMotion } from "../components/motion";
import { formatDate, formatINR, formatNumber, formatPct } from "../utils/format";
import type { HealthSlice, KpiValue, Recommendation } from "../types";

const PERIODS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "365", label: "12 months" },
];

type ViewMode = "operational" | "executive";
const VIEW_KEY = "scq_dashboard_view";

const VIEW_TABS = [
  { id: "operational", label: "Operational View" },
  { id: "executive", label: "Executive View" },
];

const INSIGHT_ICONS: Record<string, React.ReactNode> = {
  alert: <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
  target: <Target className="h-3.5 w-3.5 text-amber-500" />,
  package: <Package className="h-3.5 w-3.5 text-violet-500" />,
  truck: <Truck className="h-3.5 w-3.5 text-brand-500" />,
  trend: <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />,
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { category, period, setCategory, setPeriod } = useDashboardFilters();
  const [healthFilter, setHealthFilter] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(() =>
    (localStorage.getItem(VIEW_KEY) as ViewMode) || "operational");
  const [whyKpi, setWhyKpi] = useState<{ title: string; steps: WhyStep[]; verdict: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);

  const dash = useQuery({
    queryKey: ["dashboard", category, period],
    queryFn: () => dashboardApi.get(category, period),
  });

  const recs = useQuery({
    queryKey: ["recommendations"],
    queryFn: recommendationsApi.get,
    select: (d) => d.items.filter((r) => r.severity !== "info").slice(0, 5),
  });

  const categories = ["Electronics", "Home Appliances", "Fashion", "Grocery", "Beauty", "Sports", "Office Supplies", "Accessories", "Furniture", "Personal Care"];

  const k = dash.data?.kpis;
  const health = dash.data?.inventory_health ?? [];
  const impact = dash.data?.business_impact;
  const hs = dash.data?.health_score;
  const insights = dash.data?.insights ?? [];

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    setRefreshing(false);
  };

  const kpiWhy = (label: string, kv: KpiValue | undefined, explainer: string, formula?: WhyStep[]) => ({
    title: `Why: ${label}`,
    steps: formula ?? [{
      label: "Current value", value: kv?.value ?? 0,
      note: explainer,
    }],
    verdict: explainer,
  });

  return (
    <div>
      <PageHeader
        title="Supply Chain Command Center"
        subtitle="What is happening, why, what is next — and what to do about it."
        right={
          <>
            <Tabs tabs={VIEW_TABS} active={view} onChange={(id) => setView(id as ViewMode)} />
            <Select value={category ?? ""} onChange={(e) => setCategory(e.target.value || null)} className="w-44" aria-label="Filter by category">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Tabs tabs={PERIODS} active={String(period)} onChange={(id) => setPeriod(Number(id))} />
            <Button variant="secondary" size="sm" onClick={refresh} loading={refreshing} aria-label="Refresh data">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </>
        }
      />

      {dash.isError && (
        <Card><ErrorState message={(dash.error as Error)?.message || "Failed to load dashboard"} onRetry={() => dash.refetch()} /></Card>
      )}

      {dash.isLoading && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <SkeletonCard lines={6} /><SkeletonCard lines={6} /><SkeletonCard lines={6} />
          </div>
        </div>
      )}

      {dash.data && (
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {view === "executive" ? (
              <ExecutiveView
                dash={dash.data}
                recs={recs.data ?? []}
                onOpenProduct={(id) => navigate(`/products/${id}`)}
              />
            ) : (
              <Stagger className="space-y-5" stagger={0.05}>
                {/* KPI row */}
                <StaggerItem>
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
                    <KpiCard label="Inventory Value" value={formatINR(k?.inventory_value.value)} unit="current"
                      numericValue={k?.inventory_value.value} format={(n) => formatINR(n)}
                      changePct={k?.inventory_value.change_pct}
                      info="Value of stock on hand at unit cost."
                      onWhy={() => setWhyKpi(kpiWhy("Inventory Value", k?.inventory_value,
                        "Sum of current_stock × unit_cost across every filtered product, computed live from the inventory ledger."))} />
                    <KpiCard label="Inventory Units" value={formatNumber(k?.inventory_units.value)} unit="units"
                      numericValue={k?.inventory_units.value}
                      info="Total units currently in stock across the filtered products."
                      onWhy={() => setWhyKpi(kpiWhy("Inventory Units", k?.inventory_units,
                        "Sum of the latest closing_stock per product in the filtered set."))} />
                    <KpiCard label="Stock-Out Risks" value={formatNumber(k?.stockout_risks.value)} unit="products" accent="red"
                      numericValue={k?.stockout_risks.value}
                      info="Products projected to fall below safety stock before replenishment arrives."
                      onWhy={() => setWhyKpi(kpiWhy("Stock-Out Risks", k?.stockout_risks,
                        "Counts products whose projected stock at the supplier lead-time date falls below safety stock — derived from demand and lead time, not a static threshold."))} />
                    <KpiCard label="Overstock" value={formatNumber(k?.overstock_products.value)} unit="products" accent="violet"
                      numericValue={k?.overstock_products.value}
                      info="Products holding more than the configured days-of-cover policy."
                      onWhy={() => setWhyKpi(kpiWhy("Overstock", k?.overstock_products,
                        "Products whose days of inventory exceed the overstock policy horizon (Settings)."))} />
                    <KpiCard label="Turnover" value={k?.inventory_turnover.value ? `${k.inventory_turnover.value}x` : "—"}
                      info="COGS ÷ average inventory value. Low turnover suggests excess or slow-moving stock."
                      onWhy={() => setWhyKpi(kpiWhy("Inventory Turnover", k?.inventory_turnover,
                        "COGS over the period divided by average inventory value over the same window."))} />
                    <KpiCard label="Supplier Delay" value={formatPct(k?.supplier_delay_rate.value)} accent="yellow"
                      info="Share of recent purchase orders delivered late or marked Delayed."
                      onWhy={() => setWhyKpi(kpiWhy("Supplier Delay Rate", k?.supplier_delay_rate,
                        "Late or Delayed purchase orders ÷ total purchase orders in the period."))} />
                  </div>
                </StaggerItem>

                {/* Business impact strip (estimates) */}
                <StaggerItem>
                  <Card>
                    <CardBody className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-3">
                      <ImpactStat label="Revenue at Risk" value={formatINR(impact?.revenue_at_risk)}
                        note="Estimate: unmet units before replenishment × selling price" tone="red" icon={<IndianRupee className="h-4 w-4" />} />
                      <ImpactStat label="Excess Inventory" value={formatINR(impact?.excess_inventory_value)}
                        note="Estimate: stock above policy cover × unit cost" tone="violet" icon={<Boxes className="h-4 w-4" />} />
                      <ImpactStat label="Potential Savings / yr" value={formatINR(impact?.potential_savings)}
                        note={`Estimate: excess × ${((impact?.holding_cost_rate ?? 0.2) * 100).toFixed(0)}% holding rate (demo assumption)`} tone="green" icon={<CheckCircle2 className="h-4 w-4" />} />
                    </CardBody>
                  </Card>
                </StaggerItem>

                {/* Health + donut + demand chart */}
                <StaggerItem>
                  <div className="grid gap-4 lg:grid-cols-4">
                    {hs && <HealthScoreCard data={hs} />}
                    <Card className="lg:col-span-1">
                      <CardHeader
                        title="Inventory health mix"
                        subtitle="Click a segment to filter"
                        icon={<Gauge className="h-4 w-4" />}
                      />
                      <CardBody>
                        {health.every((h) => h.count === 0) ? (
                          <EmptyState title="No products match the current filters" />
                        ) : (
                          <>
                            <HealthDonut data={health} onSlice={(name) => setHealthFilter((cur) => (cur === name ? null : name))} />
                            <div className="mt-2 space-y-1.5">
                              {health.map((h) => (
                                <button key={h.name}
                                  onClick={() => setHealthFilter((cur) => (cur === h.name ? null : h.name))}
                                  className={`flex w-full items-center justify-between rounded-full border px-3 py-1.5 text-xs transition-colors ${
                                    healthFilter === h.name ? "border-ink bg-lime-100" : "border-ink/10 hover:bg-ink/5"
                                  }`}>
                                  <StatusBadge status={h.name as HealthSlice["name"]} />
                                  <span className="text-ink/50">{h.count} · {h.pct}%</span>
                                </button>
                              ))}
                            </div>
                            <Link to={`/inventory${healthFilter ? `?status=${encodeURIComponent(healthFilter)}` : ""}`}
                              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                              View {healthFilter ?? "all"} products in Inventory <ArrowRight className="h-3 w-3" />
                            </Link>
                          </>
                        )}
                      </CardBody>
                    </Card>

                    <div className="lg:col-span-2">
                      <DemandPanel dash={dash.data} />
                    </div>
                  </div>
                </StaggerItem>

                {/* Insights */}
                {insights.length > 0 && (
                  <StaggerItem>
                    <Card>
                      <CardHeader title="Supply Chain Insights" subtitle="Generated from live data — every line cites its number" icon={<Target className="h-4 w-4" />} />
                      <CardBody>
                        <RevealList items={insights} />
                      </CardBody>
                    </Card>
                  </StaggerItem>
                )}

                {/* Alerts + recommendations */}
                <StaggerItem>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader title="Action required" subtitle="Highest-impact alerts across the supply chain" icon={<AlertTriangle className="h-4 w-4" />} />
                      <CardBody className="space-y-2.5">
                        {(dash.data.alerts ?? []).length === 0 && <EmptyState title="No alerts" message="Nothing needs immediate attention with the current filters." />}
                        {dash.data.alerts.map((a, i) => (
                          <div key={`${a.type}-${a.title}-${i}`} className="flex items-start justify-between gap-3 rounded-2xl bg-panel/70 p-3">
                            <div className="flex items-start gap-2.5">
                              <SeverityBadge severity={a.severity} />
                              <div>
                                <p className="text-xs font-semibold text-ink">{a.title}</p>
                                <p className="mt-0.5 text-xs text-ink/50">{a.message}</p>
                              </div>
                            </div>
                            <Link to={a.cta.link} className="shrink-0">
                              <Button variant="secondary" size="sm">{a.cta.label}</Button>
                            </Link>
                          </div>
                        ))}
                      </CardBody>
                    </Card>

                    <Card>
                      <CardHeader
                        title="What should we order, when, and from whom?"
                        subtitle="Top procurement recommendations"
                        icon={<ShoppingCart className="h-4 w-4" />}
                        right={<Link to="/recommendations"><Button variant="secondary" size="sm">View all</Button></Link>}
                      />
                      <CardBody className="space-y-2.5">
                        {recs.isLoading && <SkeletonCard lines={3} />}
                        {recs.data && recs.data.length === 0 && <EmptyState title="No open recommendations" message="All products are within policy." />}
                        {recs.data?.map((r: Recommendation) => (
                          <div key={r.product_id} className="rounded-2xl bg-panel/70 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-xs font-semibold text-ink">{r.product}</p>
                                <p className="mt-0.5 text-xs text-ink/50">{r.reason}</p>
                              </div>
                              <SeverityBadge severity={r.severity} />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/50">
                              <span>Stock: <strong className="text-ink">{r.current_stock}</strong></span>
                              <span>Order: <strong className="text-brand-600">{r.recommended_quantity}</strong></span>
                              <span>Supplier: <strong className="text-ink">{r.preferred_supplier || "—"}</strong></span>
                              <span>Est. cost: <strong className="text-ink">{formatINR(r.estimated_cost)}</strong></span>
                            </div>
                            <div className="mt-2 flex gap-2">
                              <Link to={`/products/${r.product_id}`}><Button variant="secondary" size="sm">View Product</Button></Link>
                              <Button variant="lime" size="sm" onClick={() => navigate(`/purchase-orders?create=${r.product_id}`)}>
                                <ClipboardList className="h-3.5 w-3.5" /> Create PO
                              </Button>
                            </div>
                          </div>
                        ))}
                      </CardBody>
                    </Card>
                  </div>
                </StaggerItem>

                {/* Executive summary */}
                <StaggerItem>
                  <Card>
                    <CardHeader title="Executive summary" subtitle="Generated from live data — no hardcoded figures" icon={<Truck className="h-4 w-4" />} />
                    <CardBody>
                      <p className="text-sm leading-relaxed text-ink/80">{dash.data.summary}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink/40">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${dash.data.db_status.using_fallback ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${dash.data.db_status.using_fallback ? "bg-amber-500" : "bg-emerald-500"}`} />
                          {dash.data.db_status.active}
                        </span>
                        <span>Forecast method: {dash.data.forecast_method}</span>
                        <span>· Period: last {dash.data.period} days{category ? ` · ${category}` : ""}</span>
                      </div>
                    </CardBody>
                  </Card>
                </StaggerItem>
              </Stagger>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <WhyModal
        open={!!whyKpi}
        onClose={() => setWhyKpi(null)}
        title={whyKpi?.title ?? ""}
        steps={whyKpi?.steps ?? []}
        verdict={whyKpi?.verdict}
      />
    </div>
  );
}

/* ------------------------------- sub-views ------------------------------- */

function ImpactStat({ label, value, note, tone, icon }: {
  label: string; value: string; note: string; tone: "red" | "violet" | "green"; icon: React.ReactNode;
}) {
  const toneCls = tone === "red" ? "text-red-600 dark:text-red-400"
    : tone === "violet" ? "text-violet-600 dark:text-violet-400" : "text-emerald-600 dark:text-emerald-400";
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-ink/5 ${toneCls}`}>{icon}</span>
      <div>
        <p className="text-xs text-ink/50">{label}</p>
        <p className="font-display text-xl font-semibold text-ink">{value ?? "—"}</p>
        <p className="text-[10px] text-ink/40">{note}</p>
      </div>
    </div>
  );
}

function DemandPanel({ dash }: { dash: NonNullable<UseDashboardData> }) {
  return (
    <div className="flex h-full flex-col rounded-3xl bg-ink p-5 shadow-float">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lime-300 text-ink">
            <Boxes className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-white">How is demand changing?</h3>
            <p className="mt-0.5 text-xs text-white/50">
              Total daily units sold across {dash.category ?? "all categories"} — with {dash.forecast_method} forecast continuation
            </p>
          </div>
        </div>
        <InfoTip dark text="Solid line: actual units sold per day. Dashed: forecast continuation using the best backtested method." />
      </div>
      <div className="min-h-0 flex-1 pt-3">
        {dash.demand_trend.length === 0 ? (
          <p className="pt-10 text-center text-xs text-white/40">No sales in this period</p>
        ) : (
          <DemandForecastChart data={dash.demand_trend} height={300} dark />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-white/50">
        <span><strong className="font-display text-lg text-white">{formatNumber(dash.kpis.inventory_units.value)}</strong> units on hand</span>
        <span><strong className="font-display text-lg text-white">{formatINR(dash.kpis.inventory_value.value)}</strong> inventory value</span>
        <span>Period: last {dash.period} days</span>
      </div>
      <p className="mt-1 text-[10px] text-white/25">{formatDate(new Date().toISOString())} · forecast method: {dash.forecast_method}</p>
    </div>
  );
}

function ExecutiveView({ dash, recs, onOpenProduct }: {
  dash: NonNullable<UseDashboardData>;
  recs: Recommendation[];
  onOpenProduct: (id: number) => void;
}) {
  const impact = dash.business_impact;
  return (
    <Stagger className="space-y-5" stagger={0.06}>
      <StaggerItem>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Revenue at Risk" value={formatINR(impact.revenue_at_risk)} accent="red"
            numericValue={impact.revenue_at_risk} format={(n) => formatINR(n)}
            info="Estimated revenue lost to stock-outs before replenishment arrives." />
          <KpiCard label="Inventory Value" value={formatINR(dash.kpis.inventory_value.value)}
            numericValue={dash.kpis.inventory_value.value} format={(n) => formatINR(n)}
            changePct={dash.kpis.inventory_value.change_pct} />
          <KpiCard label="Excess Inventory" value={formatINR(impact.excess_inventory_value)} accent="violet"
            numericValue={impact.excess_inventory_value} format={(n) => formatINR(n)}
            info="Estimated value of stock above the cover policy." />
          <KpiCard label="Forecast Demand (30d)" value={formatNumber(dash.forecast_demand_30d ?? undefined)}
            numericValue={dash.forecast_demand_30d ?? 0} format={(n) => formatNumber(Math.round(n))}
            info="Aggregate 30-day demand forecast from the backtested model." />
        </div>
      </StaggerItem>
      <StaggerItem>
        <div className="grid gap-4 lg:grid-cols-4">
          {dash.health_score && <div className="lg:col-span-1"><HealthScoreCard data={dash.health_score} /></div>}
          <Card className="lg:col-span-3">
            <CardHeader title="Top 5 actions" subtitle="Highest-impact decisions waiting on you" icon={<ShoppingCart className="h-4 w-4" />} />
            <CardBody className="space-y-2.5">
              {recs.length === 0 && <EmptyState title="No open recommendations" message="All products are within policy." />}
              {recs.map((r, i) => (
                <motion.button
                  key={r.product_id}
                  onClick={() => onOpenProduct(r.product_id)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-panel/70 p-3 text-left transition-colors hover:bg-ink/5"
                  initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.08, duration: 0.25 }}
                >
                  <div className="flex items-center gap-3">
                    <SeverityBadge severity={r.severity} />
                    <div>
                      <p className="text-xs font-semibold text-ink">{r.product}</p>
                      <p className="text-[11px] text-ink/50">{r.action.replace("_", " ")} · {r.recommended_quantity} units · {r.preferred_supplier ?? "no supplier"}</p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-brand-600">{formatINR(r.estimated_cost)}</span>
                </motion.button>
              ))}
            </CardBody>
          </Card>
        </div>
      </StaggerItem>
      <StaggerItem>
        <Card>
          <CardHeader title="Executive summary" icon={<Truck className="h-4 w-4" />} />
          <CardBody><p className="text-sm leading-relaxed text-ink/80">{dash.summary}</p></CardBody>
        </Card>
      </StaggerItem>
    </Stagger>
  );
}

function RevealList({ items }: { items: { icon: string; tone: string; text: string }[] }) {
  const reduce = useReducedMotion();
  return (
    <ul className="space-y-2">
      {items.map((ins, i) => (
        <motion.li
          key={i}
          className="flex items-start gap-2.5 rounded-xl bg-panel/70 px-3 py-2"
          initial={reduce ? false : { opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: reduce ? 0 : 0.15 + i * 0.12, duration: 0.25 }}
        >
          <span className="mt-0.5">{INSIGHT_ICONS[ins.icon] ?? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}</span>
          <p className="text-xs leading-relaxed text-ink/80">{ins.text}</p>
        </motion.li>
      ))}
    </ul>
  );
}

// Local type alias to keep sub-view props readable.
type UseDashboardData = Awaited<ReturnType<typeof dashboardApi.get>>;
