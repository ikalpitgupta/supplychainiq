import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight, FlaskConical, GitCompareArrows, Plus, RotateCcw, Save, Trash2, TrendingDown, TrendingUp,
} from "lucide-react";import { intelligenceApi, productsApi } from "../api/endpoints";
import {
  Button, Card, CardBody, CardHeader, ErrorState, Select, Skeleton, Table, TD, TH, THead, TR,
} from "../components/ui";
import { PageHeader } from "../components/shared";
import { Stagger, StaggerItem } from "../components/motion";
import { formatINR, formatNumber } from "../utils/format";
import type { ScenarioBranch, ScenarioResponse } from "../types";

/** Slider with a centered readout; a plain range input styled by the app CSS. */
function Slider({ label, value, min, max, step, onChange, format, hint }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string; hint?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-ink/70">{label}</label>
        <span className="font-display text-sm font-semibold text-lime-300">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-lime-400"
        aria-label={label}
      />
      {hint && <p className="mt-0.5 text-[11px] text-ink/40">{hint}</p>}
    </div>
  );
}

function BranchStats({ branch, title, tone }: { branch: ScenarioBranch; title: string; tone: "base" | "sim" }) {
  const o = branch.outputs;
  return (
    <div className={`flex-1 rounded-2xl border p-4 ${tone === "base" ? "border-ink/10 bg-ink/[0.02]" : "border-lime-400/25 bg-lime-400/[0.05]"}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink/50">{title}</p>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink/50">Risk tier</dt>
          <dd><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${o.risk_tier === "CRITICAL" ? "bg-red-500/15 text-red-400" : o.risk_tier === "HIGH" ? "bg-amber-400/15 text-amber-400" : o.risk_tier === "MEDIUM" ? "bg-sky-400/15 text-sky-400" : "bg-emerald-500/15 text-emerald-400"}`}>{o.risk_tier}</span></dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink/50">Days to zero</dt>
          <dd className="font-medium text-ink">{formatNumber(o.days_to_zero)} d</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink/50">Reorder point</dt>
          <dd className="font-medium text-ink">{formatNumber(o.reorder_point)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink/50">Revenue at risk</dt>
          <dd className="font-medium text-ink">{formatINR(o.revenue_at_risk)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink/50">Recommended order</dt>
          <dd className="font-medium text-ink">{formatNumber(o.recommended_qty)} units</dd>
        </div>
      </dl>
    </div>
  );
}

interface SavedScenario { name: string; demandPct: number; leadDelta: number; safetyStock: number | null; stock: number | null; result: ScenarioResponse }

export default function ScenarioSimulatorPage() {
  const options = useQuery({ queryKey: ["product-options"], queryFn: productsApi.options });
  const [productId, setProductId] = useState<number | undefined>();
  const effectiveId = productId ?? options.data?.items?.[0]?.id;

  const [demandPct, setDemandPct] = useState(0);
  const [leadDelta, setLeadDelta] = useState(0);
  const [safetyStock, setSafetyStock] = useState<number | null>(null);
  const [stock, setStock] = useState<number | null>(null);
  const [saved, setSaved] = useState<SavedScenario[]>([]);

  const sim = useQuery({
    queryKey: ["scenario", effectiveId, demandPct, leadDelta, safetyStock, stock],
    queryFn: () => intelligenceApi.scenario(effectiveId as number, {
      demandChangePct: demandPct, leadTimeDeltaDays: leadDelta, safetyStock: safetyStock, stock: stock,
    }),
    enabled: !!effectiveId,
    placeholderData: (prev) => prev, // keep last real result visible while recalculating
  });

  const active = sim.data;
  const isDefault = demandPct === 0 && leadDelta === 0 && safetyStock === null && stock === null;
  const costCurve = useQuery({
    queryKey: ["cost-curve", effectiveId],
    queryFn: () => intelligenceApi.costCurve(effectiveId as number),
    enabled: !!effectiveId,
  });

  const curveMax = useMemo(() => Math.max(1, ...(costCurve.data?.curve ?? []).map((p) => p.total_cost)), [costCurve.data]);
  const curveMinService = useMemo(() => {
    const c = costCurve.data?.curve ?? [];
    if (!c.length) return null;
    return c.reduce((best, p) => (p.total_cost < best.total_cost ? p : best), c[0]);
  }, [costCurve.data]);

  const saveCurrent = () => {
    if (!active) return;
    setSaved((s) => [
      ...s.slice(-3),
      {
        name: `${demandPct >= 0 ? "+" : ""}${demandPct}% demand · ${leadDelta >= 0 ? "+" : ""}${leadDelta}d lead`,
        demandPct, leadDelta, safetyStock, stock, result: active,
      },
    ]);
  };

  const s = active?.scenario.outputs;
  const b = active?.baseline.outputs;

  return (
    <div>
      <PageHeader
        title="Scenario Simulator"
        subtitle="What-if analysis on real inventory math — every output recalculates server-side."
        right={options.data && (
          <Select value={effectiveId ?? ""} onChange={(e) => { setProductId(Number(e.target.value)); setSaved([]); }} className="w-60" aria-label="Product">
            {options.data.items.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.sku})</option>)}
          </Select>
        )}
      />

      {sim.isFetching && <p className="sr-only" role="status">Recalculating…</p>}

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader icon={<FlaskConical size={15} aria-hidden />} title="Scenario inputs" subtitle="Move a slider — the projection updates from live data." />
          <CardBody className="space-y-5">
            <Slider label="Demand change" value={demandPct} min={-50} max={100} step={5} onChange={setDemandPct}
              format={(v) => `${v >= 0 ? "+" : ""}${v}%`} hint="Applied to the rolling-baseline daily demand." />
            <Slider label="Lead time change" value={leadDelta} min={-5} max={30} step={1} onChange={setLeadDelta}
              format={(v) => `${v >= 0 ? "+" : ""}${v} days`} hint={`Supplier lead time: ${active?.baseline.inputs.lead_time_days ?? "—"} d baseline.`} />
            <Slider label="Safety stock override" value={safetyStock ?? Math.round(b?.safety_stock ?? 0)} min={0} max={400} step={10}
              onChange={(v) => setSafetyStock(v)} format={(v) => `${v} units`}
              hint={safetyStock === null ? "Using policy safety stock (z × σ√L)." : "Overridden — policy value ignored."} />
            <Slider label="Inventory level" value={stock ?? 0} min={0} max={Math.max(600, Math.round((b ? b.recommended_qty + b.reorder_point : 600) * 1.5))} step={10}
              onChange={(v) => setStock(v)} format={(v) => `${v} units`}
              hint={stock === null ? `Current on-hand: ${formatNumber(active?.baseline.inputs.current_stock ?? 0)} units.` : `Baseline on-hand: ${formatNumber(active?.baseline.inputs.current_stock ?? 0)} units.`} />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => { setDemandPct(0); setLeadDelta(0); setSafetyStock(null); setStock(null); }} disabled={isDefault}>
                <RotateCcw size={13} className="mr-1" aria-hidden /> Reset
              </Button>
              <Button variant="secondary" size="sm" onClick={saveCurrent} disabled={!active || isDefault}>
                <Plus size={13} className="mr-1" aria-hidden /> Save scenario
              </Button>
            </div>
          </CardBody>
        </Card>

        <div className="min-w-0">
          {sim.isLoading || !active ? (
            <Skeleton className="h-72 w-full" />
          ) : sim.isError ? (
            <ErrorState message="Simulation failed." onRetry={() => sim.refetch()} />
          ) : (
            <Stagger className="space-y-5">
              <StaggerItem>
                <Card>
                  <CardHeader
                    icon={<GitCompareArrows size={15} aria-hidden />}
                    title={`${active.product.name} — baseline vs scenario`}
                    subtitle={isDefault ? "Baseline (no overrides applied)." : `Scenario: ${demandPct >= 0 ? "+" : ""}${demandPct}% demand, ${leadDelta >= 0 ? "+" : ""}${leadDelta}d lead time`}
                    right={s && b && s.risk_tier !== b.risk_tier && (
                      <span className="flex items-center gap-1 text-xs font-medium text-ink/60">
                        {b.risk_tier} <ArrowRight size={12} aria-hidden /> <span className="text-ink">{s.risk_tier}</span>
                      </span>
                    )}
                  />
                  <CardBody className="flex flex-col gap-3 md:flex-row">
                    <BranchStats branch={active.baseline} title="Current" tone="base" />
                    <BranchStats branch={active.scenario} title="Simulated" tone="sim" />
                  </CardBody>
                  {!isDefault && s && b && (
                    <CardBody className="grid grid-cols-2 gap-3 border-t border-ink/10 pt-0 sm:grid-cols-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-ink/40">Revenue at risk Δ</p>
                        <p className={`flex items-center gap-1 font-display text-base font-semibold ${s.revenue_at_risk > b.revenue_at_risk ? "text-red-400" : "text-emerald-400"}`}>
                          {s.revenue_at_risk > b.revenue_at_risk ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
                          {formatINR(Math.abs(s.revenue_at_risk - b.revenue_at_risk))}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-ink/40">Recommended order Δ</p>
                        <p className={`font-display text-base font-semibold ${s.recommended_qty > b.recommended_qty ? "text-amber-400" : "text-emerald-400"}`}>
                          {s.recommended_qty > b.recommended_qty ? "+" : ""}{formatNumber(s.recommended_qty - b.recommended_qty)} units
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-ink/40">Order cost @ scenario qty</p>
                        <p className="font-display text-base font-semibold text-ink">{formatINR(s.recommended_qty_cost)}</p>
                      </div>
                    </CardBody>
                  )}
                </Card>
              </StaggerItem>

              {saved.length > 0 && (
                <StaggerItem>
                  <Card>
                    <CardHeader icon={<GitCompareArrows size={15} aria-hidden />} title="Saved scenarios" subtitle="Compare up to 4 runs side by side." />
                    <CardBody className="overflow-x-auto">
                      <Table>
                        <THead>
                          <tr>
                            <TH>Scenario</TH><TH>Risk</TH><TH>Rev. at risk</TH><TH>Order qty</TH><TH>Days to zero</TH><TH /></tr>
                        </THead>
                        <tbody>
                          <TR>
                            <TD><span className="font-medium text-ink/70">Baseline</span></TD>
                            <TD>{active.baseline.outputs.risk_tier}</TD>
                            <TD>{formatINR(active.baseline.outputs.revenue_at_risk)}</TD>
                            <TD>{formatNumber(active.baseline.outputs.recommended_qty)}</TD>
                            <TD>{formatNumber(active.baseline.outputs.days_to_zero)}</TD>
                            <TD />
                          </TR>
                          {saved.map((sv, i) => (
                            <TR key={i}>
                              <TD className="whitespace-nowrap">{sv.name}</TD>
                              <TD>{sv.result.scenario.outputs.risk_tier}</TD>
                              <TD>{formatINR(sv.result.scenario.outputs.revenue_at_risk)}</TD>
                              <TD>{formatNumber(sv.result.scenario.outputs.recommended_qty)}</TD>
                              <TD>{formatNumber(sv.result.scenario.outputs.days_to_zero)}</TD>
                              <TD>
                                <button onClick={() => setSaved((arr) => arr.filter((_, j) => j !== i))} className="text-ink/40 hover:text-red-400" aria-label={`Remove ${sv.name}`}>
                                  <Trash2 size={14} aria-hidden />
                                </button>
                              </TD>
                            </TR>
                          ))}
                        </tbody>
                      </Table>
                    </CardBody>
                  </Card>
                </StaggerItem>
              )}

              <StaggerItem>
                <Card>
                  <CardHeader
                    icon={<Save size={15} aria-hidden />}
                    title="Cost vs service level"
                    subtitle="Total inventory cost (holding + expected stock-out) at each service level — the U-curve picks the cheapest point."
                    right={curveMinService && (
                      <span className="text-xs text-ink/50">
                        optimum ≈ <span className="font-semibold text-lime-300">{Math.round(curveMinService.service_level * 100)}%</span> ({formatINR(curveMinService.total_cost)})
                      </span>
                    )}
                  />
                  <CardBody>
                    {costCurve.isLoading ? (
                      <Skeleton className="h-44 w-full" />
                    ) : (
                      <div className="flex h-44 items-end gap-1.5" role="img" aria-label="Total cost by service level chart">
                        {(costCurve.data?.curve ?? []).map((p) => {
                          const h = Math.max(4, (p.total_cost / curveMax) * 100);
                          const isOpt = curveMinService && p.service_level === curveMinService.service_level;
                          return (
                            <div key={p.service_level} className="group relative flex-1">
                              <div
                                className={`w-full rounded-t-md transition-colors ${isOpt ? "bg-lime-400" : "bg-ink/15 group-hover:bg-ink/30"}`}
                                style={{ height: `${h}%` }}
                              />
                              <div className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-chrome px-2 py-1 text-[10px] text-white group-hover:block">
                                {Math.round(p.service_level * 100)}% · {formatINR(p.total_cost)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-1 flex justify-between text-[10px] text-ink/40">
                      <span>90% service</span><span>95%</span><span>99%</span>
                    </div>
                  </CardBody>
                </Card>
              </StaggerItem>
            </Stagger>
          )}
        </div>
      </div>

      <div className="mt-6">
        <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-ink/60">
            Happy with the scenario? Turn the recommendation into a purchase order in one click.
          </p>
          <Link
            to={`/products/${effectiveId ?? ""}`}
            className="rounded-full bg-chrome px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-chrome-soft"
          >
            Open product &amp; act <ArrowRight size={14} className="ml-1 inline" aria-hidden />
          </Link>
        </Card>
      </div>
    </div>
  );
}
