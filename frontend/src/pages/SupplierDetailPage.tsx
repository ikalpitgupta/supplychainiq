import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { suppliersApi } from "../api/endpoints";
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton, SkeletonCard } from "../components/ui";
import { KpiCard, PageHeader } from "../components/shared";
import { AnimatedNumber } from "../components/motion";
import { MonthlyLineChart, SimpleBarChart } from "../components/charts";
import { formatINR, formatNumber, formatPct } from "../utils/format";

export default function SupplierDetailPage() {
  const { id } = useParams();
  const supplierId = Number(id);

  const q = useQuery({
    queryKey: ["supplier", supplierId],
    queryFn: () => suppliersApi.detail(supplierId),
    enabled: Number.isFinite(supplierId) && supplierId > 0,
  });

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}</div>
        <SkeletonCard lines={8} />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return <Card><ErrorState message={(q.error as Error)?.message || `Supplier ${id} not found`} onRetry={() => q.refetch()} /></Card>;
  }

  const d = q.data;
  const s = d.score;

  return (
    <div className="cascade">
      <Link to="/suppliers" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink/50 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Suppliers
      </Link>
      <PageHeader
        title={d.name}
        subtitle={`${d.contact_email ?? "no contact on file"} · Lead time ${d.lead_time_days} days · Cost index ${d.unit_cost.toFixed(2)}`}
        right={<Badge tone={d.risk_level === "Low" ? "green" : d.risk_level === "Medium" ? "yellow" : "red"} dot>{d.risk_level} risk</Badge>}
      />

      {/* Score strip — animated count-up + staggered component bars */}
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs text-ink/50">Supplier score</p>
            <p className="font-display text-3xl font-semibold text-ink">
              <AnimatedNumber value={s.total} format={(n) => String(Math.round(n))} />
              <span className="text-base text-ink/35">/100</span>
            </p>
          </div>
          <div className="flex flex-1 flex-wrap gap-4 text-xs">
            {[
              { label: `Delivery ${s.weights.delivery}%`, pts: s.delivery },
              { label: `Quality ${s.weights.quality}%`, pts: s.quality },
              { label: `Cost ${s.weights.cost}%`, pts: s.cost },
              { label: `Reliability ${s.weights.reliability}%`, pts: s.reliability },
            ].map((c, i) => (
              <motion.div
                key={c.label}
                className="min-w-[120px] flex-1"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.12, duration: 0.3 }}
              >
                <div className="flex justify-between">
                  <span className="text-ink/50">{c.label}</span>
                  <span className="font-semibold text-ink">{c.pts.toFixed(0)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-ink/10">
                  <motion.div
                    className={`h-1.5 rounded-full ${c.pts >= 65 ? "bg-emerald-500" : c.pts >= 45 ? "bg-amber-500" : "bg-red-500"}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${c.pts}%` }}
                    transition={{ delay: 0.3 + i * 0.12, duration: 0.45 }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Total Orders" value={formatNumber(d.kpis.orders)} info="Purchase orders placed with this supplier in the last 12 months." />
        <KpiCard label="Total Spend" value={formatINR(d.kpis.total_spend)} info="Value of all POs with this supplier in the last 12 months." />
        <KpiCard label="Observed On-Time" value={d.kpis.ontime_observed_pct !== null ? formatPct(d.kpis.ontime_observed_pct) : "—"}
          info="Share of recent POs delivered on or before the expected date, computed from actual deliveries." />
        <KpiCard label="Delayed POs" value={formatNumber(d.kpis.delayed)} info="Purchase orders that arrived after the expected date." />
        <KpiCard label="Defect Rate" value={formatPct(d.defect_rate * 100, 1)} info="Quality baseline for this supplier." />
      </div>

      {/* Narrative summary */}
      <Card className="mt-4">
        <CardHeader title="Summary" subtitle="Generated from this supplier's live performance data" />
        <CardBody><p className="text-sm leading-relaxed text-ink">{d.summary}</p></CardBody>
      </Card>

      {/* Trends */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Is delivery performance stable?" subtitle="Monthly on-time % (blank months = no deliveries)" />
          <CardBody>
            {d.delivery_trend.length === 0 ? <EmptyStateInline text="No delivery history in the last 12 months." /> :
              <MonthlyLineChart data={d.delivery_trend as unknown as Record<string, unknown>[]} dataKey="on_time_pct" name="On-time %" color="#059669" />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Are we paying more over time?" subtitle="Average unit cost per month (cost index)" />
          <CardBody>
            {d.cost_trend.length === 0 ? <EmptyStateInline text="No purchase history." /> :
              <MonthlyLineChart data={d.cost_trend as unknown as Record<string, unknown>[]} dataKey="avg_unit_cost" name="Avg unit cost" color="#d97706" />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="How much do we order from this supplier?" subtitle="Monthly order volume (units and PO count)" />
          <CardBody>
            {d.volume_trend.length === 0 ? <EmptyStateInline text="No purchase history." /> :
              <SimpleBarChart data={d.volume_trend as unknown as Record<string, unknown>[]} dataKey="quantity" name="Units ordered" />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What does this supplier provide?" subtitle="Products by category" />
          <CardBody>
            {Object.keys(d.category_mix).length === 0 ? <EmptyStateInline text="No products assigned." /> :
              <SimpleBarChart vertical
                data={Object.entries(d.category_mix).map(([name, count]) => ({ name, count }))}
                dataKey="count" name="Products" color="#7c3aed" />}
          </CardBody>
        </Card>
      </div>

      {/* Products */}
      <Card className="mt-4">
        <CardHeader title={`Products supplied (${d.products.length})`} subtitle="Click through for product-level analytics" />
        <CardBody className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {d.products.map((p) => (
            <Link key={p.id} to={`/products/${p.id}`}
              className="rounded-lg border border-ink/10 px-3 py-2 text-xs hover:border-brand-500/40 hover:bg-brand-500/10">
              <span className="font-medium text-ink">{p.name}</span>
              <span className="block text-ink/35">{p.sku} · {p.category}</span>
            </Link>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function EmptyStateInline({ text }: { text: string }) {
  return <p className="py-10 text-center text-xs text-ink/35">{text}</p>;
}
