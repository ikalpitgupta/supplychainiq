// Supply Chain Command Center — the decision-first dashboard.
//
// Organized around the four questions an operator actually asks:
//   1. Where should I look?    — prioritized problems + portfolio health
//   2. Why is it happening?    — root-cause insights + demand-vs-replenishment chart
//   3. What should I do?       — ranked recommended actions
//   4. What is the impact?     — revenue at risk, cost exposure, capital, opportunity
//
// Every number comes from the live API; every KPI carries a "Why?" explainer.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "../components/motion";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, BadgeDollarSign, CheckCircle2, ClipboardList,
  PackageCheck, PackageSearch, RefreshCw, RotateCcw, ShoppingCart, Target, TrendingUp, Truck, XCircle,
} from "lucide-react";
import {
  dashboardApi, fulfillmentApi, metaApi, outboundApi, recommendationsApi,
} from "../api/endpoints";
import { useDashboardFilters } from "../hooks/useFilters";
import {
  Button, Card, CardBody, CardHeader, EmptyState, ErrorState, InfoTip, Select, SkeletonCard, Tabs,
} from "../components/ui";
import { KpiCard, PageHeader, SeverityBadge, StatusBadge } from "../components/shared";
import { HealthScoreCard } from "../components/shared/HealthScoreCard";
import { RootCauseChainCard } from "../components/shared/RootCauseChainCard";
import { PiInsightCard } from "../components/shared/PiInsightCard";
import { WhyModal } from "../components/shared/WhyModal";
import type { WhyStep } from "../components/shared/WhyModal";
import { DemandForecastChart, HealthDonut } from "../components/charts";
import { Stagger, StaggerItem, useReducedMotion } from "../components/motion";
import { formatDate, formatINR, formatNumber, formatPct } from "../utils/format";
import type { DashboardData, HealthSlice, KpiValue, Recommendation } from "../types";

const PERIODS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "365", label: "12 months" },
];

const INSIGHT_ICONS: Record<string, React.ReactNode> = {
  alert: <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
  target: <Target className="h-3.5 w-3.5 text-amber-500" />,
  package: <PackageSearch className="h-3.5 w-3.5 text-violet-500" />,
  truck: <Truck className="h-3.5 w-3.5 text-brand-500" />,
  trend: <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />,
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const { category, period, setCategory, setPeriod } = useDashboardFilters();
  const [healthFilter, setHealthFilter] = useState<string | null>(null);
  const [whyKpi, setWhyKpi] = useState<{ title: string; steps: WhyStep[]; verdict: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const dash = useQuery({
    queryKey: ["dashboard", category, period],
    queryFn: () => dashboardApi.get(category, period),
  });

  const recs = useQuery({
    queryKey: ["recommendations"],
    queryFn: recommendationsApi.get,
    select: (d) => ({
      critical: d.items.filter((r) => r.severity === "critical").slice(0, 5),
      counts: d.counts,
    }),
  });

  const delivery = useQuery({
    queryKey: ["delivery-90"],
    queryFn: () => fulfillmentApi.summary(90),
    staleTime: 60_000,
  });

  // Measured returns from the outbound order book (replaces the old placeholder).
  const returns = useQuery({
    queryKey: ["returns-intel-90"],
    queryFn: () => outboundApi.returnsIntel(90),
    staleTime: 300_000,
  });

  // Customer-experience window: operations vs cancellations/returns.
  const cxImpact = useQuery({
    queryKey: ["outbound-customer-impact"],
    queryFn: () => outboundApi.customerImpact(30),
    staleTime: 60_000,
  });
  const ci = cxImpact.data;

  // Category filter options come from the live meta endpoint (no hardcoded list).
  const catsQ = useQuery({ queryKey: ["meta-categories"], queryFn: metaApi.categories, staleTime: 300_000 });
  const categories = catsQ.data?.items ?? [];

  const k = dash.data?.kpis;
  const health = dash.data?.inventory_health ?? [];
  const impact = dash.data?.business_impact;
  const hs = dash.data?.health_score;
  const insights = dash.data?.insights ?? [];

  // Fulfillment rate: of everything ordered (excl. cancelled), how much actually arrived.
  const poCounts = delivery.data?.status_counts ?? {};
  const poTotal = delivery.data?.total_pos ?? 0;
  const poCancelled = poCounts["Cancelled"] ?? 0;
  const poDelivered = poCounts["Delivered"] ?? 0;
  const fulfillmentRate = poTotal - poCancelled > 0 ? poDelivered / (poTotal - poCancelled) : null;

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    await queryClient.invalidateQueries({ queryKey: ["delivery-90"] });
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
        subtitle="Monitor inventory, fulfillment, delivery and customer-impact risks."
        right={
          <>
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
        <Stagger className="space-y-8" stagger={0.05}>
          {/* ── Top KPIs: the six decision metrics ─────────────────────────── */}
          <StaggerItem>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard label="Inventory Health" value={hs ? String(Math.round(hs.total)) : "—"} unit="/100"
                accent={hs && hs.total < 60 ? "red" : hs && hs.total < 75 ? "yellow" : "green"}
                numericValue={hs?.total}
                info={`Weighted composite of inventory, stock-out, supplier, forecast, overstock and procurement components. Grade: ${hs?.grade ?? "—"}.`}
                onWhy={() => setWhyKpi(kpiWhy("Inventory Health", undefined,
                  `Weighted composite of six components; the weakest is ${(hs ? weakestComponent(hs) : "—")}. Open the full breakdown from the health card below.`))} />
              <KpiCard label="Stock-out Exposure" value={formatNumber(k?.stockout_risks.value)} unit="products" accent="red"
                numericValue={k?.stockout_risks.value}
                info="Products projected to fall below safety stock before replenishment arrives."
                onWhy={() => setWhyKpi(kpiWhy("Stock-out Exposure", k?.stockout_risks,
                  "Counts products whose projected stock at the supplier lead-time date falls below safety stock — derived from demand and lead time, not a static threshold."))} />
              <KpiCard label="Fulfillment Rate" value={fulfillmentRate != null ? formatPct(fulfillmentRate * 100) : "—"}
                accent={fulfillmentRate != null && fulfillmentRate < 0.85 ? "yellow" : "green"}
                numericValue={fulfillmentRate != null ? Math.round(fulfillmentRate * 100) : 0}
                info={`Share of ordered POs that actually arrived (last 90 days). ${poTotal - poCancelled} live orders, ${poCancelled} cancelled.`}
                onWhy={() => setWhyKpi(kpiWhy("Fulfillment Rate", undefined,
                  `Delivered POs ÷ (all live POs − cancelled). ${poDelivered} of ${poTotal - poCancelled} live orders delivered in the window.`))} />
              <KpiCard label="On-time Delivery" value={delivery.data ? formatPct(delivery.data.on_time_rate * 100) : "—"}
                accent={delivery.data && delivery.data.on_time_rate < 0.85 ? "yellow" : "green"}
                numericValue={delivery.data ? Math.round(delivery.data.on_time_rate * 100) : 0}
                info={delivery.data?.avg_delay_days != null ? `Late POs average +${delivery.data.avg_delay_days.toFixed(1)} days against the expected date.` : "Delivered POs that arrived on or before the expected date."}
                onWhy={() => setWhyKpi(kpiWhy("On-time Delivery", undefined,
                  "On-or-before-expected deliveries ÷ delivered POs in the window (inbound supplier delivery performance)."))} />
              <KpiCard label="Return Rate" value={returns.data?.return_rate_pct != null ? `${returns.data.return_rate_pct}%` : "—"}
                accent={returns.data?.return_rate_pct != null && returns.data.return_rate_pct >= 20 ? "red" : returns.data?.return_rate_pct != null && returns.data.return_rate_pct >= 12 ? "yellow" : "green"}
                numericValue={returns.data?.return_rate_pct ?? 0}
                info={`Measured from the outbound order book: ${formatNumber(returns.data?.returns ?? 0)} returns across ${formatNumber(returns.data?.delivered_orders ?? 0)} delivered orders, last 90 days.`}
                onWhy={() => setWhyKpi(kpiWhy("Return Rate", undefined,
                  `Measured returns ÷ delivered orders over 90 days — ${formatNumber(returns.data?.returns ?? 0)} of ${formatNumber(returns.data?.delivered_orders ?? 0)}. Sized categories (apparel, footwear) return at higher rates than one-size goods; see the Returns page for the category split.`))} />
              <KpiCard label="Revenue at Risk" value={formatINR(impact?.revenue_at_risk)} accent="red"
                numericValue={impact?.revenue_at_risk} format={(n) => formatINR(n)}
                info={`Estimated unmet sales before replenishment arrives${impact?.top_risk_category ? ` — concentrated in ${impact.top_risk_category}` : ""}.`}
                onWhy={() => setWhyKpi(kpiWhy("Revenue at Risk", undefined,
                  "Expected lost units at stock-out × selling price, summed across at-risk products."))} />
            </div>
          </StaggerItem>

          {/* ── Section 1 · Where should I look? ───────────────────────────── */}
          <Section heading="Where should I look?" lead="Highest-priority problems across the network, ranked by impact.">
            <div className="grid gap-4 lg:grid-cols-4">
              <Card className="lg:col-span-2">
                <CardHeader title="Which problems need attention today?" subtitle="Alerts are generated from live thresholds — each links to where the issue lives." icon={<AlertTriangle className="h-4 w-4" />} />
                <CardBody className="space-y-2.5">
                  {(dash.data.alerts ?? []).length === 0 && <EmptyState title="No alerts" message="Nothing needs immediate attention with the current filters." />}
                  {dash.data.alerts.map((a, i) => (
                    <motion.div key={`${a.type}-${a.title}-${i}`} className="flex items-start justify-between gap-3 rounded-2xl bg-panel/70 p-3"
                      initial={reduceMotion ? undefined : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: reduceMotion ? 0 : 0.1 + i * 0.06, duration: 0.25 }}>
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
                    </motion.div>
                  ))}
                </CardBody>
              </Card>

              {hs && <HealthScoreCard data={hs} />}

              <Card>
                <CardHeader title="Where is inventory health concentrated?" subtitle="Click a segment to filter" icon={<PackageSearch className="h-4 w-4" />} />
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
            </div>
          </Section>

          {/* ── Section 2 · Why is it happening? ───────────────────────────── */}
          <Section heading="Why is it happening?" lead="Root causes, each with the numbers behind the claim.">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardHeader title="What do the root-cause signals say?" subtitle="Generated from live data — every line cites its number" icon={<Target className="h-4 w-4" />} />
                <CardBody>
                  {insights.length === 0 ? (
                    <EmptyState title="No signals right now" message="Root-cause insights appear as patterns emerge." />
                  ) : (
                    <RevealList items={insights} />
                  )}
                </CardBody>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader
                  title="Is demand outpacing replenishment?"
                  subtitle={`Actual daily units sold vs the ${dash.data.forecast_method} forecast — the gap is what drives stock-outs.`}
                  icon={<TrendingUp className="h-4 w-4" />}
                  right={<InfoTip text="Solid line: actual units sold per day. Dashed: forecast continuation using the best backtested method." />}
                />
                <CardBody>
                  {dash.data.demand_trend.length === 0 ? (
                    <EmptyState title="No sales in this period" />
                  ) : (
                    <DemandForecastChart data={dash.data.demand_trend} height={280} />
                  )}
                  <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/50">
                    <span><strong className="font-display text-base text-ink">{formatNumber(dash.data.kpis.inventory_units.value)}</strong> units on hand</span>
                    <span><strong className="font-display text-base text-ink">{dash.data.forecast_demand_30d != null ? formatNumber(dash.data.forecast_demand_30d) : "—"}</strong> forecast units, next 30d</span>
                    <span>Method: {dash.data.forecast_method} · backtested</span>
                  </p>
                </CardBody>
              </Card>
            </div>

            {/* Interactive root-cause chain — every hop carries measured evidence. */}
            <RootCauseChainCard days={30} />

            {/* Contextual Product Intelligence — one grounded answer for the section's question. */}
            <PiInsightCard question="Why is delivery performance declining?" />
          </Section>

          {/* ── Section 3 · What should I do? ──────────────────────────────── */}
          <Section heading="What should I do?" lead="Ranked actions — quantity, supplier, and timing already computed.">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader
                  title="Which orders should go out first?"
                  subtitle="Top recommendations by financial impact"
                  icon={<ShoppingCart className="h-4 w-4" />}
                  right={<Link to="/insights"><Button variant="secondary" size="sm">View all {(recs.data?.counts.critical ?? 0) + (recs.data?.counts.warning ?? 0) + (recs.data?.counts.opportunity ?? 0)}</Button></Link>}
                />
                <CardBody className="space-y-2.5">
                  {recs.isLoading && <SkeletonCard lines={3} />}
                  {recs.data && recs.data.critical.length === 0 && <EmptyState title="No critical actions" message="All products are within policy — check the Opportunities tab in Insights & Actions." />}
                  {recs.data?.critical.map((r: Recommendation, i) => (
                    <motion.div key={r.product_id} className="rounded-2xl bg-panel/70 p-3"
                      initial={reduceMotion ? undefined : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: reduceMotion ? 0 : 0.08 + i * 0.06, duration: 0.25 }}>
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
                        <Button variant="lime" size="sm" onClick={() => navigate(`/fulfillment?create=${r.product_id}`)}>
                          <ClipboardList className="h-3.5 w-3.5" /> Create PO
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Which suppliers are creating fulfillment risk?"
                  subtitle="Delivery performance below expectation deserves a conversation."
                  icon={<Truck className="h-4 w-4" />}
                />
                <CardBody className="space-y-2.5">
                  {delivery.data && delivery.data.late_orders.length === 0 ? (
                    <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-5 text-sm text-emerald-600 dark:text-emerald-400">
                      Every delivered PO arrived on time in the last 90 days.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs leading-relaxed text-ink/60">
                        <strong className="text-ink">{delivery.data?.late_orders.length ?? "—"}</strong> late deliveries in the last 90 days,
                        averaging <strong className="text-ink">+{delivery.data?.avg_delay_days?.toFixed(1) ?? "—"} days</strong>.
                      </p>
                      {(delivery.data?.late_orders ?? []).slice(0, 4).map((po) => (
                        <div key={po.id} className="flex items-center justify-between gap-2 rounded-2xl bg-panel/70 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-ink">{po.supplier}</p>
                            <p className="truncate text-[11px] text-ink/50">{po.product} · {po.po_number}</p>
                          </div>
                          <span className="shrink-0 text-xs font-semibold text-red-500">+{po.days_late}d</span>
                        </div>
                      ))}
                      <Link to="/delivery" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                        Where are delivery SLAs breaking? <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </>
                  )}
                </CardBody>
              </Card>
            </div>
          </Section>

          {/* ── Section 4 · What is the impact? ────────────────────────────── */}
          <Section heading="What is the impact?" lead="The financial footprint of the risks above — and the opportunity of fixing them.">
            {ci && (
              <Card className="mb-4">
                <CardHeader
                  title="How do operations show up for customers?"
                  subtitle="Recent half of the 30-day window vs the prior half — stated only when both sides are measurable."
                  icon={<Truck className="h-4 w-4" />}
                />
                <CardBody className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
                  <ImpactStat label="Late delivery rate" tone="red" icon={<Truck className="h-4 w-4" />}
                    value={ci.recent.late_rate_pct != null ? `${ci.recent.late_rate_pct}%` : "—"}
                    note={ci.prior.late_rate_pct != null ? `prior half: ${ci.prior.late_rate_pct}%` : "no prior window"} />
                  <ImpactStat label="Cancellation rate" tone="violet" icon={<XCircle className="h-4 w-4" />}
                    value={ci.recent.cancel_rate_pct != null ? `${ci.recent.cancel_rate_pct}%` : "—"}
                    note={`est. ₹${Math.round(ci.recent.cancelled_revenue / 1000)}K demand lost before dispatch`} />
                  <ImpactStat label="Returns (30d)" tone="blue" icon={<RotateCcw className="h-4 w-4" />}
                    value={formatNumber(ci.recent.returns)}
                    note={ci.prior.returns ? `prior half: ${formatNumber(ci.prior.returns)}` : "no prior window"} />
                  <ImpactStat label="Delivered orders" tone="green" icon={<PackageCheck className="h-4 w-4" />}
                    value={formatNumber(ci.recent.orders)}
                    note="customer orders in the recent half-window" />
                </CardBody>
              </Card>
            )}

            <Card>
              <CardBody className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <ImpactStat label="Revenue at Risk" value={formatINR(impact?.revenue_at_risk)}
                  note="Estimate: unmet units before replenishment × selling price" tone="red" icon={<BadgeDollarSign className="h-4 w-4" />} />
                <ImpactStat label="Cost Exposure / yr" value={formatINR(impact?.potential_savings)}
                  note={`Estimate: excess stock × ${((impact?.holding_cost_rate ?? 0.2) * 100).toFixed(0)}% holding rate (demo assumption)`} tone="violet" icon={<PackageSearch className="h-4 w-4" />} />
                <ImpactStat label="Inventory Value" value={formatINR(k?.inventory_value.value)}
                  note={`Current capital in stock · ${k?.inventory_value.change_pct != null ? `${k.inventory_value.change_pct > 0 ? "+" : ""}${k.inventory_value.change_pct}% vs prior period` : "period-matched"}`} tone="blue" icon={<ShoppingCart className="h-4 w-4" />} />
                <ImpactStat label="Improvement Opportunity" value={formatINR(impact?.excess_inventory_value)}
                  note="Capital releasable if excess stock above policy cover is worked down" tone="green" icon={<CheckCircle2 className="h-4 w-4" />} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Executive summary" subtitle="Generated from live data — no hardcoded figures" icon={<Target className="h-4 w-4" />} />
              <CardBody>
                <p className="text-sm leading-relaxed text-ink/80">{dash.data.summary}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink/40">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${dash.data.db_status.using_fallback ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${dash.data.db_status.using_fallback ? "bg-amber-500" : "bg-emerald-500"}`} />
                    {dash.data.db_status.active}
                  </span>
                  <span>Forecast method: {dash.data.forecast_method}</span>
                  <span>· Period: last {dash.data.period} days{category ? ` · ${category}` : ""}</span>
                  <span>· {formatDate(new Date().toISOString())}</span>
                </div>
              </CardBody>
            </Card>
          </Section>
        </Stagger>
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

/* ------------------------------- helpers -------------------------------- */

function weakestComponent(hs: NonNullable<DashboardData["health_score"]>): string {
  let worst = ""; let worstScore = 101;
  for (const [name, c] of Object.entries(hs.components)) {
    if (c.score < worstScore) { worstScore = c.score; worst = name; }
  }
  return `${worst} (${Math.round(worstScore)}/100)`;
}

/** Section shell: a decision question, its one-line intent, then the content. */
function Section({ heading, lead, children }: { heading: string; lead: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <section aria-label={heading}>
      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
        className="mb-3 flex items-baseline gap-3"
      >
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-ink/70">{heading}</h2>
        <span className="h-px flex-1 bg-ink/10" aria-hidden />
        <p className="hidden text-xs text-ink/40 md:block">{lead}</p>
      </motion.div>
      {children}
    </section>
  );
}

function ImpactStat({ label, value, note, tone, icon }: {
  label: string; value: string; note: string; tone: "red" | "violet" | "green" | "blue"; icon: React.ReactNode;
}) {
  const toneCls = tone === "red" ? "text-red-600 dark:text-red-400"
    : tone === "violet" ? "text-violet-600 dark:text-violet-400"
    : tone === "blue" ? "text-brand-600 dark:text-brand-400"
    : "text-emerald-600 dark:text-emerald-400";
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

