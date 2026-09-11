import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BarChart3, Clock, Layers, PackageSearch, PieChart, ShieldAlert, TrendingUp, Truck,
} from "lucide-react";
import { intelligenceApi } from "../api/endpoints";
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton, Table, TD, TH, THead, TR } from "../components/ui";
import { PageHeader } from "../components/shared";
import { Stagger, StaggerItem } from "../components/motion";
import { formatINR, formatNumber } from "../utils/format";

const SEGMENT_TONES: Record<string, "green" | "blue" | "yellow" | "red" | "gray" | "violet"> = {
  AX: "green", AY: "blue", AZ: "yellow", BX: "blue", BY: "gray", BZ: "yellow",
  CX: "gray", CY: "violet", CZ: "red",
};

function ConcentrationBar({ shares }: { shares: { supplier_id: number; supplier: string; share_pct: number }[] }) {
  const colors = ["bg-lime-400", "bg-sky-400", "bg-violet-400", "bg-amber-400", "bg-ink/30"];
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink/10">
        {shares.slice(0, 5).map((s, i) => (
          <div key={s.supplier_id} className={colors[i]} style={{ width: `${s.share_pct}%` }} title={`${s.supplier}: ${s.share_pct}%`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {shares.slice(0, 5).map((s, i) => (
          <span key={s.supplier_id} className="flex items-center gap-1.5 text-[11px] text-ink/60">
            <span className={`h-2 w-2 rounded-full ${colors[i]}`} aria-hidden />
            {s.supplier} · {s.share_pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

function AbcXyzPanel() {
  const q = useQuery({ queryKey: ["abcxyz"], queryFn: intelligenceApi.abcXyz });
  const [filter, setFilter] = useState<string | null>(null);
  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    return filter ? all.filter((i) => i.segment === filter) : all;
  }, [q.data, filter]);
  const summary = q.data?.summary ?? [];

  return (
    <Card>
      <CardHeader
        icon={<Layers size={15} aria-hidden />}
        title="ABC × XYZ segmentation"
        subtitle="A/B/C by annual consumption value · X/Y/Z by demand variability (CV). Each segment carries a distinct inventory strategy."
      />
      <CardBody>
        {q.isLoading ? <Skeleton className="h-40 w-full" /> : q.isError ? (
          <ErrorState message="Failed to load segmentation." onRetry={() => q.refetch()} />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-9">
              {summary.map((s) => (
                <button
                  key={s.segment}
                  onClick={() => setFilter(filter === s.segment ? null : s.segment)}
                  className={`rounded-xl border px-2 py-1.5 text-center transition-colors ${filter === s.segment ? "border-lime-400/60 bg-lime-400/10" : "border-ink/10 bg-ink/[0.02] hover:bg-ink/[0.06]"}`}
                  title={`${s.segment}: ${formatINR(s.annual_value)} annual value`}
                >
                  <p className="font-display text-sm font-semibold text-ink">{s.segment}</p>
                  <p className="text-[10px] text-ink/50">{s.count} SKUs</p>
                </button>
              ))}
            </div>
            <div className="max-h-72 overflow-y-auto">
              <Table>
                <THead>
                  <tr><TH>Product</TH><TH>Segment</TH><TH className="text-right">Annual demand</TH><TH className="text-right">Inventory value</TH></tr>
                </THead>
                <tbody>
                  {items.slice(0, 40).map((i) => (
                    <TR key={i.id}>
                      <TD>
                        <Link to={`/products/${i.id}`} className="font-medium text-ink hover:text-lime-300">{i.name}</Link>
                        <span className="ml-2 text-[11px] text-ink/40">{i.sku}</span>
                      </TD>
                      <TD>
                        <Badge tone={SEGMENT_TONES[i.segment] ?? "gray"}>{i.segment}</Badge>
                      </TD>
                      <TD className="text-right">{formatNumber(i.annual_demand)}</TD>
                      <TD className="text-right">{formatINR(i.inventory_value)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
            {filter && <p className="mt-2 text-[11px] text-ink/50">Filtered to {filter} — click the tile again to clear.</p>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function AgingPanel() {
  const q = useQuery({ queryKey: ["aging"], queryFn: intelligenceApi.aging });
  const buckets = q.data?.buckets ?? [];
  const maxValue = Math.max(1, ...buckets.map((b) => b.value));
  return (
    <Card>
      <CardHeader
        icon={<Clock size={15} aria-hidden />}
        title="Inventory aging"
        subtitle={q.data ? `${formatINR(q.data.stale_value)} unsold for 90+ days across ${q.data.stale_products} products (days since last replenishment).` : "Buckets by days since last receipt."}
      />
      <CardBody className="space-y-3">
        {q.isLoading ? <Skeleton className="h-32 w-full" /> : q.isError ? (
          <ErrorState message="Failed to load aging." onRetry={() => q.refetch()} />
        ) : (
          <>
            {buckets.map((b) => (
              <div key={b.bucket}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="text-ink/60">{b.bucket} days · {b.products} products</span>
                  <span className="font-medium text-ink">{formatINR(b.value)} <span className="text-ink/40">({b.pct}%)</span></span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-ink/10">
                  <div
                    className={`h-full rounded-full ${b.bucket === "90+" ? "bg-red-500" : b.bucket === "61-90" ? "bg-amber-400" : b.bucket === "31-60" ? "bg-sky-400" : "bg-emerald-500"}`}
                    style={{ width: `${(b.value / maxValue) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-ink/40">{q.data?.note}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function VelocityPanel() {
  const q = useQuery({ queryKey: ["velocity"], queryFn: intelligenceApi.velocityMatrix });
  const items = q.data?.items ?? [];
  const t = q.data?.thresholds;
  const quadrants = [
    { key: "Star", label: "Star", desc: "high demand · high value", cls: "border-emerald-500/30 bg-emerald-500/[0.06]" },
    { key: "Fast Moving", label: "Fast Moving", desc: "high demand · low value", cls: "border-sky-400/30 bg-sky-400/[0.06]" },
    { key: "Slow Moving", label: "Slow Moving", desc: "low demand · high value", cls: "border-amber-400/30 bg-amber-400/[0.06]" },
    { key: "Dead Stock", label: "Dead Stock", desc: "low demand · low value", cls: "border-red-500/30 bg-red-500/[0.06]" },
  ];
  return (
    <Card>
      <CardHeader
        icon={<PieChart size={15} aria-hidden />}
        title="Velocity matrix"
        subtitle={t ? `Split at median demand (${t.demand_median.toFixed(1)} u/day) and median inventory value (${formatINR(t.value_median)}).` : "2×2 by demand velocity × inventory value."}
      />
      <CardBody>
        {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError ? (
          <ErrorState message="Failed to load velocity matrix." onRetry={() => q.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {quadrants.map((qd) => {
                const stats = q.data?.quadrants[qd.key];
                const inQ = items.filter((i) => i.segment === qd.key);
                return (
                  <div key={qd.key} className={`rounded-2xl border p-3 ${qd.cls}`}>
                    <p className="text-sm font-semibold text-ink">{qd.label}</p>
                    <p className="text-[11px] text-ink/50">{qd.desc}</p>
                    <p className="mt-1 font-display text-lg font-semibold text-ink">{stats?.count ?? 0} <span className="text-xs font-normal text-ink/50">SKUs · {formatINR(stats?.value ?? 0)}</span></p>
                    <p className="mt-1 line-clamp-1 text-[11px] text-ink/50">{inQ.slice(0, 3).map((i) => i.name).join(", ")}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function SlowMoversPanel() {
  const q = useQuery({ queryKey: ["slow-movers"], queryFn: intelligenceApi.slowMovers });
  const items = q.data?.items ?? [];
  return (
    <Card>
      <CardHeader
        icon={<PackageSearch size={15} aria-hidden />}
        title="Slow movers & excess"
        subtitle={q.data ? `${formatINR(q.data.total_excess_value)} of excess stock above policy cover.` : "Products holding more stock than policy requires."}
      />
      <CardBody className="overflow-x-auto">
        {q.isLoading ? <Skeleton className="h-40 w-full" /> : q.isError ? (
          <ErrorState message="Failed to load slow movers." onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-5 text-sm text-emerald-400">No slow movers — every product is within its policy cover.</p>
        ) : (
          <Table>
            <THead>
              <tr><TH>Product</TH><TH className="text-right">Days of inv.</TH><TH className="text-right">Excess units</TH><TH className="text-right">Excess value</TH></tr>
            </THead>
            <tbody>
              {items.slice(0, 12).map((i) => (
                <TR key={i.product_id}>
                  <TD>
                    <Link to={`/products/${i.product_id}`} className="font-medium text-ink hover:text-lime-300">{i.name}</Link>
                    <p className="text-[11px] text-ink/40">{i.recommendation}</p>
                  </TD>
                  <TD className="text-right">{formatNumber(i.days_of_inventory)}</TD>
                  <TD className="text-right">{formatNumber(i.excess_units)}</TD>
                  <TD className="text-right">{formatINR(i.excess_value)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

export default function ProcurementPage() {
  const proc = useQuery({ queryKey: ["procurement"], queryFn: intelligenceApi.procurement });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement Intelligence"
        subtitle="Spend concentration, single-source dependencies, price drift, and negotiation levers — all computed from purchase-order history."
        right={proc.data && (
          <div className="rounded-2xl bg-surface px-4 py-2.5 shadow-card">
            <p className="font-display text-xl font-semibold text-ink">{formatINR(proc.data.total_spend)}</p>
            <p className="text-[10px] uppercase tracking-wider text-ink/40">spend · {proc.data.window_days}d window</p>
          </div>
        )}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={<ShieldAlert size={15} aria-hidden />}
            title="Single-source dependencies"
            subtitle={proc.data ? `${proc.data.single_source.length} products rely on exactly one active supplier.` : "…"}
          />
          <CardBody className="space-y-2.5">
            {proc.isLoading ? <Skeleton className="h-40 w-full" /> : proc.isError ? (
              <ErrorState message="Failed to load procurement intelligence." onRetry={() => proc.refetch()} />
            ) : proc.data?.single_source.length === 0 ? (
              <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-5 text-sm text-emerald-400">Every product has at least two qualified suppliers.</p>
            ) : (
              (proc.data?.single_source ?? []).slice(0, 6).map((s) => (
                <div key={s.product_id} className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/products/${s.product_id}`} className="text-sm font-medium text-ink hover:text-lime-300">{s.name}</Link>
                    <Badge tone="red">single source</Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink/50">
                    <Link to={`/suppliers/${s.supplier_id}`} className="text-ink/70 hover:text-lime-300">{s.supplier}</Link>
                    {" · "}{formatINR(s.annual_spend)} annual spend · {s.lead_time_days}d lead · {s.share_pct}% of volume
                  </p>
                  <p className="mt-1.5 text-[11px] text-ink/60">{s.suggestion}</p>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon={<TrendingUp size={15} aria-hidden />}
            title="Purchase price alerts"
            subtitle={proc.data ? `${proc.data.price_alerts.length} products with ≥5% unit-cost movement (90d vs prior).` : "…"}
          />
          <CardBody className="space-y-2.5">
            {proc.isLoading ? <Skeleton className="h-40 w-full" /> : (proc.data?.price_alerts ?? []).length === 0 ? (
              <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-5 text-sm text-emerald-400">Unit costs are stable across the portfolio.</p>
            ) : (
              (proc.data?.price_alerts ?? []).slice(0, 6).map((p) => (
                <div key={p.product_id} className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/products/${p.product_id}`} className="text-sm font-medium text-ink hover:text-lime-300">{p.name}</Link>
                    <Badge tone={p.direction === "increase" ? "red" : "green"}>
                      {p.direction === "increase" ? "+" : ""}{p.change_pct}% unit cost
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink/50">
                    {formatINR(p.prior_avg_cost)} → {formatINR(p.recent_avg_cost)} · annualized impact {formatINR(p.annualized_impact)}
                  </p>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon={<BarChart3 size={15} aria-hidden />}
            title="Supplier concentration"
            subtitle={proc.data ? `HHI ${proc.data.concentration.hhi} — ${proc.data.concentration.level} concentration; top supplier holds ${proc.data.concentration.top_share_pct}% of spend.` : "…"}
          />
          <CardBody>
            {proc.isLoading ? <Skeleton className="h-24 w-full" /> : proc.data && <ConcentrationBar shares={proc.data.concentration.shares} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon={<Truck size={15} aria-hidden />}
            title="Negotiation opportunities"
            subtitle="Analytical suggestions grounded in observed spend, cost index, and delivery performance."
          />
          <CardBody className="space-y-2.5">
            {proc.isLoading ? <Skeleton className="h-32 w-full" /> : (proc.data?.opportunities ?? []).map((o, i) => (
              <div key={i} className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-3.5">
                <p className="text-sm font-medium text-ink">{o.supplier}</p>
                <p className="mt-0.5 text-[11px] text-ink/60">{o.note}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Stagger className="space-y-5">
        <StaggerItem><div className="grid gap-5 lg:grid-cols-2"><AgingPanel /><VelocityPanel /></div></StaggerItem>
        <StaggerItem><SlowMoversPanel /></StaggerItem>
        <StaggerItem><AbcXyzPanel /></StaggerItem>
      </Stagger>
    </div>
  );
}
