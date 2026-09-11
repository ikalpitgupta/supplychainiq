import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart3, DollarSign, Gauge, Lightbulb, PackageSearch, Timer } from "lucide-react";
import { analyticsApi } from "../api/endpoints";
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, InfoTip, Skeleton, Table, TD, TH, THead, TR } from "../components/ui";
import { KpiCard, PageHeader, SeverityBadge } from "../components/shared";
import { MonthlyLineChart, ParetoChart, SimpleBarChart } from "../components/charts";
import { formatINR, formatNumber, formatPct } from "../utils/format";
import type { AnalyticsData } from "../types";

export default function AnalyticsPage() {
  const q = useQuery({ queryKey: ["analytics"], queryFn: () => analyticsApi.get(365) });

  if (q.isError) return <Card><ErrorState message={(q.error as Error)?.message || "Failed to load analytics"} onRetry={() => q.refetch()} /></Card>;
  if (q.isLoading || !q.data) {
    return (
      <div>
        <PageHeader title="Analytics" subtitle="Advanced business analytics across inventory, procurement, and sales." />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const d: AnalyticsData = q.data;

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Advanced business analytics across inventory, procurement, sales, and operations." />

      {/* Dynamic insights */}
      <Card className="mb-4">
        <CardHeader title="What should the business know today?" subtitle="Insights are computed from live data — nothing hardcoded" icon={<Lightbulb className="h-4 w-4" />} />
        <CardBody className="grid gap-3 md:grid-cols-2">
          {d.insights.length === 0 && <EmptyState title="No insights yet" message="Insights appear as data patterns emerge." />}
          {d.insights.map((i) => (
            <div key={i.title} className="rounded-xl border border-ink/10 p-3">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={i.severity} />
                <p className="text-xs font-semibold text-ink">{i.title}</p>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink/70">{i.text}</p>
              <Link to={i.link} className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">Investigate →</Link>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Inventory */}
      <section className="mb-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <Gauge className="h-4 w-4 text-brand-600" /> Inventory efficiency
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KpiCard label="Inventory Turnover" value={d.inventory.turnover ? `${d.inventory.turnover}x` : "—"}
            info="COGS ÷ average inventory. Higher = stock converts to sales faster." />
          <KpiCard label="Days Inventory Outstanding" value={d.inventory.days_inventory_outstanding ? `${d.inventory.days_inventory_outstanding}` : "—"} unit="days"
            info="Average days a unit sits in stock before selling (DIO)." />
          <KpiCard label="Avg Inventory Value" value={formatINR(d.inventory.avg_inventory_value)} info="Mean daily inventory value over the period." />
          <KpiCard label="Holding Cost (annual est.)" value={formatINR(d.inventory.holding_cost_annual)}
            info="Average inventory × holding-cost rate (demo assumption from Settings)." />
          <KpiCard label="Zero-Demand Products" value={formatNumber(d.inventory.zero_demand_products)}
            info="Products with no sales in the period — dead-stock candidates." />
        </div>
      </section>

      {/* Procurement */}
      <section className="mb-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <DollarSign className="h-4 w-4 text-brand-600" /> Procurement
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-4">
            <KpiCard label="Purchase Spend (12mo)" value={formatINR(d.procurement.total_spend)} info="Total value of purchase orders in the period." />
            <KpiCard label="On-Time Delivery" value={formatPct(d.procurement.on_time_pct)} info="Share of delivered POs that arrived on or before the expected date." />
            <KpiCard label="Avg Lead Time" value={d.procurement.avg_lead_time_days ? `${d.procurement.avg_lead_time_days}` : "—"} unit="days"
              info="Order date → actual delivery date, averaged across delivered POs." />
            <KpiCard label="Price Variance" value={d.procurement.purchase_price_variance_pct !== null ? formatPct(d.procurement.purchase_price_variance_pct) : "—"}
              info="Average gap between PO unit cost and product master cost (purchase price variance)." />
          </div>
          <Card>
            <CardHeader title="Where does procurement spend go?" subtitle="Top suppliers by 12-month spend" />
            <CardBody>
              {d.procurement.spend_by_supplier.length === 0 ? <EmptyState title="No purchase orders" /> :
                <SimpleBarChart vertical money
                  data={d.procurement.spend_by_supplier.map((s) => ({ name: s.supplier, spend: s.spend }))}
                  dataKey="spend" name="Spend" height={280} />}
            </CardBody>
          </Card>
        </div>
      </section>

      {/* Sales */}
      <section className="mb-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <BarChart3 className="h-4 w-4 text-brand-600" /> Sales & demand
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="How is demand changing?" subtitle="Monthly revenue, last 12 months" />
            <CardBody><MonthlyLineChart money data={d.sales.revenue_trend as unknown as Record<string, unknown>[]} dataKey="revenue" name="Revenue" height={260} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Which products carry the business?" subtitle="Top 10 products by revenue" />
            <CardBody>
              <Table>
                <THead><TR><TH>Product</TH><TH className="text-right">Units</TH><TH className="text-right">Revenue</TH></TR></THead>
                <tbody>
                  {d.sales.top_products.map((p) => (
                    <TR key={p.product_id}>
                      <TD><Link to={`/products/${p.product_id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link></TD>
                      <TD className="text-right text-ink/50">{formatNumber(p.units)}</TD>
                      <TD className="text-right text-ink/70">{formatINR(p.revenue)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        </div>
      </section>

      {/* Operational efficiency */}
      <section className="mb-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <Timer className="h-4 w-4 text-brand-600" /> Operational efficiency
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Open Purchase Orders" value={formatNumber(d.efficiency.open_purchase_orders)} info="POs currently drafted, pending, ordered, or in transit." />
          <KpiCard label="Delayed POs" value={formatNumber(d.efficiency.delayed_purchase_orders)} accent="red"
            info="POs late against their expected date — direct stock-out drivers." />
          <KpiCard label="Delay Rate" value={formatPct(d.efficiency.delayed_pct)} info="Delayed ÷ total POs in the period." />
          <KpiCard label="Cancelled POs" value={formatNumber(d.efficiency.cancelled_purchase_orders)} info="Cancelled orders in the period." />
        </div>
      </section>

      {/* ABC analysis */}
      <section className="mb-4" id="abc">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <PackageSearch className="h-4 w-4 text-brand-600" /> ABC analysis
          <InfoTip text="Products ranked by annual consumption value (annual demand × unit cost). A = top ~80% of value, B = next 15%, C = tail." />
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Category summary" subtitle="SKU share vs value share" />
            <CardBody className="space-y-3">
              {d.abc.summary.map((s) => (
                <div key={s.class} className="rounded-xl border border-ink/10 p-3">
                  <div className="flex items-center justify-between">
                    <Badge tone={s.class === "A" ? "blue" : s.class === "B" ? "yellow" : "gray"}>Class {s.class}</Badge>
                    <span className="text-xs text-ink/50">{s.sku_count} SKUs</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-ink/10">
                    <div className="h-2 rounded-full bg-brand-500" style={{ width: `${s.value_share}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-ink/50">
                    {s.sku_share}% of SKUs → <strong className="text-ink">{s.value_share}% of value</strong> ({formatINR(s.value)})
                  </p>
                </div>
              ))}
              <p className="text-xs leading-relaxed text-ink/50">
                A-category products should receive tight monitoring and priority replenishment; C-category items
                can run on simple min/max policies to save effort.
              </p>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="How concentrated is inventory value?" subtitle="Pareto curve — cumulative share of consumption value by product rank" />
            <CardBody>
              {d.abc.pareto.length === 0 ? <EmptyState title="No data" /> : <ParetoChart data={d.abc.pareto} height={300} />}
              <p className="mt-2 text-xs text-ink/50">
                If the curve rises very fast, a small number of SKUs dominate value — focus planning effort there.
              </p>
            </CardBody>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader title="ABC classification by product" subtitle="Top 25 by consumption value" />
          <Table>
            <THead>
              <TR>
                <TH>#</TH><TH>Product</TH><TH>Category</TH>
                <TH className="text-right">Annual Demand</TH><TH className="text-right">Unit Cost</TH>
                <TH className="text-right">Consumption Value</TH><TH className="text-right">Cumulative %</TH><TH>Class</TH>
              </TR>
            </THead>
            <tbody>
              {d.abc.items.slice(0, 25).map((r, idx) => (
                <TR key={r.product_id}>
                  <TD className="text-ink/35">{idx + 1}</TD>
                  <TD><Link to={`/products/${r.product_id}`} className="font-medium text-brand-700 hover:underline">{r.name}</Link></TD>
                  <TD className="text-ink/50">{r.category}</TD>
                  <TD className="text-right text-ink/50">{formatNumber(r.annual_demand)}</TD>
                  <TD className="text-right text-ink/50">{formatINR(r.unit_cost, false)}</TD>
                  <TD className="text-right text-ink/70">{formatINR(r.consumption_value)}</TD>
                  <TD className="text-right text-ink/50">{r.cumulative_share.toFixed(1)}%</TD>
                  <TD><Badge tone={r.class === "A" ? "blue" : r.class === "B" ? "yellow" : "gray"}>{r.class}</Badge></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
