// Network Scenario Lab — "what happens if the business situation changes?"
// Every animated stage is a real intermediate of the server-side calculation
// (demand → requirement → stock-out → fulfillment → SLA → revenue → capital),
// so the animation represents arithmetic in flight, not decoration.
import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle, ArrowDown, Boxes, FlaskConical, GitCompareArrows, IndianRupee,
  Landmark, Package, Play, RotateCcw, TrendingUp, Truck, Warehouse,
} from "lucide-react";
import { intelligenceApi } from "../../api/endpoints";
import { Button, Card, CardBody, CardHeader, ErrorState, Select, Skeleton } from "../ui";
import { AnimatedNumber, EASE } from "../motion";
import { formatINR } from "../../utils/format";
import type { NetworkScenarioInputs, ScenarioStage } from "../../types";

const ZERO: NetworkScenarioInputs = {
  demand_pct: 0, lead_delta_days: 0, home_allocation: 100, service_level: 0.95,
  promo_uplift_pct: 0, promo_discount: 0, capacity_factor: 100,
};

const PRESETS: { name: string; inputs: Partial<NetworkScenarioInputs>; blurb: string }[] = [
  { name: "Baseline", inputs: {}, blurb: "Today's network, no changes." },
  { name: "Demand surge +20%", inputs: { demand_pct: 20 }, blurb: "Viral product or seasonal spike." },
  { name: "Festive promo +30% @ 40% off", inputs: { promo_uplift_pct: 30, promo_discount: 40 }, blurb: "Campaign uplift with deep discounting." },
  { name: "Supplier slip +7 days", inputs: { lead_delta_days: 7 }, blurb: "Vendor delays every replenishment." },
  { name: "Capacity crunch", inputs: { capacity_factor: 80, home_allocation: 60 }, blurb: "Warehouses understaffed, stock mis-allocated." },
  { name: "Downturn −15%", inputs: { demand_pct: -15 }, blurb: "Demand contracts — overstock risk." },
];

const STAGE_ICONS: Record<string, React.ReactNode> = {
  demand: <TrendingUp size={15} aria-hidden />,
  requirement: <Package size={15} aria-hidden />,
  stockout: <AlertTriangle size={15} aria-hidden />,
  fulfillment: <Warehouse size={15} aria-hidden />,
  sla: <Truck size={15} aria-hidden />,
  revenue: <IndianRupee size={15} aria-hidden />,
  capital: <Landmark size={15} aria-hidden />,
};

const SEV_DOT: Record<ScenarioStage["severity"], string> = {
  good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-red-400", neutral: "bg-ink/30",
};
const SEV_TEXT: Record<ScenarioStage["severity"], string> = {
  good: "text-emerald-400", warn: "text-amber-400", bad: "text-red-400", neutral: "text-ink",
};

function fmtFor(unit: string): (n: number) => string {
  if (unit === "₹") return (n) => formatINR(n);
  if (unit.startsWith("%")) return (n) => `${n.toFixed(1)}%`;
  return (n) => Math.round(n).toLocaleString("en-IN");
}

function LabSlider({ label, value, min, max, step, onChange, format, hint }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string; hint?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-ink/70">{label}</label>
        <span className="font-display text-sm font-semibold text-lime-300">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-lime-400" aria-label={label} />
      {hint && <p className="mt-0.5 text-[11px] text-ink/40">{hint}</p>}
    </div>
  );
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v}%`;
const days = (v: number) => `${v >= 0 ? "+" : ""}${v}d`;

function StageRow({ stage, index }: { stage: ScenarioStage; index: number }) {
  const reduce = false;
  const fmt = fmtFor(stage.unit);
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : 0.05 + index * 0.07, duration: 0.3, ease: EASE }}
      className="flex items-start gap-3"
    >
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-ink/10 bg-ink/[0.03] ${SEV_TEXT[stage.severity]}`}>
        {STAGE_ICONS[stage.key] ?? <Boxes size={15} aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 border-b border-ink/[0.06] pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <span className={`h-1.5 w-1.5 rounded-full ${SEV_DOT[stage.severity]}`} aria-hidden />
            {stage.label}
          </p>
          <p className={`font-display text-base font-semibold tabular-nums ${SEV_TEXT[stage.severity]}`}>
            <AnimatedNumber value={stage.to} format={fmt} ariaLabel={`${stage.label}: ${fmt(stage.to)}`} />
            {stage.from != null && (
              <span className="ml-1.5 text-xs font-normal text-ink/40">from {fmt(stage.from)}</span>
            )}
          </p>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-ink/50">{stage.detail}</p>
      </div>
    </motion.div>
  );
}

export default function NetworkScenarioLab() {
  const [inputs, setInputs] = useState<NetworkScenarioInputs>({ ...ZERO });
  const [activePreset, setActivePreset] = useState("Baseline");
  const [compareA, setCompareA] = useState<Partial<NetworkScenarioInputs>>({ demand_pct: 20 });
  const [compareB, setCompareB] = useState<Partial<NetworkScenarioInputs>>({ demand_pct: -15, home_allocation: 70 });
  const [runCompare, setRunCompare] = useState(false);

  const deferred = useDeferredValue(inputs);
  const sim = useQuery({
    queryKey: ["network-scenario", deferred],
    queryFn: () => intelligenceApi.networkScenario({ ...deferred, label: "Scenario" }),
    placeholderData: (prev) => prev,
  });

  const cmp = useQuery({
    queryKey: ["network-compare", compareA, compareB],
    queryFn: () => intelligenceApi.networkCompare(compareA, compareB),
    enabled: runCompare,
    placeholderData: (prev) => prev,
  });

  const applyPreset = (name: string) => {
    const p = PRESETS.find((x) => x.name === name);
    if (!p) return;
    setActivePreset(name);
    setInputs({ ...ZERO, ...p.inputs });
  };

  const set = (k: keyof NetworkScenarioInputs) => (v: number) => {
    setActivePreset("Custom");
    setInputs((s) => ({ ...s, [k]: v }));
  };

  const run = sim.data;
  const busy = sim.isFetching;
  const isDefault = activePreset === "Baseline";

  return (
    <div className="space-y-5">
      {/* Inputs */}
      <Card>
        <CardHeader
          icon={<FlaskConical size={15} aria-hidden />}
          title="Business scenario inputs"
          subtitle="Change the situation — inventory, fulfillment, delivery and capital all recalculate from live data."
          right={
            <Button variant="secondary" size="sm" onClick={() => applyPreset("Baseline")} disabled={isDefault}>
              <RotateCcw size={13} className="mr-1" aria-hidden /> Reset
            </Button>
          }
        />
        <CardBody className="space-y-5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Scenario presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p.name)}
                title={p.blurb}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activePreset === p.name
                    ? "border-lime-400/40 bg-lime-400/10 text-lime-300"
                    : "border-ink/10 bg-ink/[0.02] text-ink/60 hover:border-ink/25 hover:text-ink"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <LabSlider label="Demand change" value={inputs.demand_pct} min={-50} max={100} step={5} onChange={set("demand_pct")} format={pct}
              hint="Shock applied to the trailing sales baseline." />
            <LabSlider label="Supplier lead time" value={inputs.lead_delta_days} min={-5} max={30} step={1} onChange={set("lead_delta_days")} format={days}
              hint={`Network average today: ${(run?.outputs.avg_lead_days ?? 0) - inputs.lead_delta_days > 0 ? (run?.outputs.avg_lead_days ?? 0) - inputs.lead_delta_days : "—"} d baseline.`} />
            <LabSlider label="Home-DC allocation" value={inputs.home_allocation} min={40} max={100} step={5} onChange={set("home_allocation")} format={(v) => `${v}%`}
              hint="Share of demand serviceable from the nearest DC." />
            <LabSlider label="Service level" value={inputs.service_level} min={0.85} max={0.999} step={0.001} onChange={set("service_level")} format={(v) => `${(v * 100).toFixed(1)}%`}
              hint={`z = ${run?.basis.service_level_z?.toFixed(2) ?? "—"} — the safety-stock multiplier.`} />
            <LabSlider label="Promotion uplift" value={inputs.promo_uplift_pct} min={0} max={60} step={5} onChange={set("promo_uplift_pct")} format={pct}
              hint={`Discount cost at current depth: ${formatINR(run?.outputs.promo_discount_cost ?? 0)}.`} />
            <LabSlider label="Promotion discount depth" value={inputs.promo_discount} min={0} max={50} step={5} onChange={set("promo_discount")} format={(v) => `${v}% off`}
              hint="Margin given away on incremental units." />
            <LabSlider label="Warehouse capacity" value={inputs.capacity_factor} min={60} max={120} step={5} onChange={set("capacity_factor")} format={(v) => `${v}%`}
              hint="Throughput vs the demonstrated baseline." />
          </div>
        </CardBody>
      </Card>

      {/* Calculation chain + outputs */}
      {sim.isLoading || !run ? (
        <Skeleton className="h-96 w-full" />
      ) : sim.isError ? (
        <ErrorState message="Scenario calculation failed." onRetry={() => sim.refetch()} />
      ) : (
        <div className={`grid gap-5 transition-opacity lg:grid-cols-[1fr_360px] ${busy ? "opacity-70" : "opacity-100"}`}>
          <Card>
            <CardHeader
              icon={<Play size={15} aria-hidden />}
              title="How the scenario propagates"
              subtitle="Each step is a real stage of the calculation — numbers settle as the engine recomputes."
            />
            <CardBody>
              <div className="space-y-3" aria-live="polite">
                {run.stages.map((st, i) => (
                  <div key={st.key}>
                    <StageRow stage={st} index={i} />
                    {i < run.stages.length - 1 && (
                      <div className="ml-[15px] h-4 text-ink/20" aria-hidden>
                        <ArrowDown size={14} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader icon={<GitCompareArrows size={15} aria-hidden />} title="Scenario outputs" subtitle={run.label} />
              <CardBody className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink/40">Revenue at risk</p>
                  <p className="font-display text-xl font-semibold text-red-400">
                    <AnimatedNumber value={run.outputs.revenue_at_risk} format={formatINR} />
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink/40">Working capital</p>
                  <p className="font-display text-xl font-semibold text-ink">
                    <AnimatedNumber value={run.outputs.required_capital} format={formatINR} />
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink/40">Projected late rate</p>
                  <p className="font-display text-xl font-semibold text-amber-400">
                    <AnimatedNumber value={run.outputs.projected_late_rate * 100} format={(n) => `${n.toFixed(1)}%`} />
                    <span className="ml-1.5 text-xs font-normal text-ink/40">now {(run.outputs.current_late_rate * 100).toFixed(1)}%</span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink/40">Fulfillment risk</p>
                  <p className="font-display text-xl font-semibold text-sky-400">
                    <AnimatedNumber value={run.outputs.fulfillment_risk_pct} format={(n) => `${n.toFixed(0)}%`} />
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink/40">Stock-out products</p>
                  <p className="font-display text-xl font-semibold text-ink">{run.outputs.stockout_products}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink/40">Safety stock (network)</p>
                  <p className="font-display text-xl font-semibold text-ink">
                    <AnimatedNumber value={run.outputs.safety_stock_units} format={(n) => Math.round(n).toLocaleString("en-IN")} />
                  </p>
                </div>
              </CardBody>
            </Card>

            <Card className="border-lime-400/25 bg-lime-400/[0.04]">
              <CardHeader icon={<FlaskConical size={15} aria-hidden />} title="Recommended action" />
              <CardBody>
                <p className="text-sm leading-relaxed text-ink">{run.outputs.recommended_action}</p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader icon={<Boxes size={15} aria-hidden />} title="Watch-list" subtitle="Fastest products to zero under this scenario." />
              <CardBody>
                {run.outputs.critical_products.length === 0 ? (
                  <p className="text-sm text-ink/50">No product falls below safety stock within the lead window.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {run.outputs.critical_products.map((c) => (
                      <li key={c.product_id} className="flex items-center justify-between gap-2">
                        <span className="text-ink/70">Product #{c.product_id}</span>
                        <span className="font-medium text-red-400">{c.days_to_zero.toFixed(1)} d to zero</span>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="mt-3 text-xs text-ink/40">
                  <summary className="cursor-pointer select-none hover:text-ink/60">Method & basis</summary>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4">
                    {run.basis.notes.map((n, i) => <li key={i}>{n}</li>)}
                    <li>{run.basis.products} products · {run.basis.window_days}-day demand window · routing blend measured from the 45-day order book.</li>
                  </ul>
                </details>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* Compare */}
      <Card>
        <CardHeader
          icon={<GitCompareArrows size={15} aria-hidden />}
          title="Compare scenarios"
          subtitle="Current vs Scenario A vs Scenario B — same engine, side by side."
          right={
            <Button size="sm" onClick={() => setRunCompare(true)} disabled={runCompare && cmp.isFetching}>
              <Play size={13} className="mr-1" aria-hidden /> Run comparison
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {([["Scenario A", compareA, setCompareA], ["Scenario B", compareB, setCompareB]] as const).map(([title, val, setter]) => (
              <div key={title} className="rounded-2xl border border-ink/10 p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink/50">{title}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabSlider label="Demand" value={val.demand_pct ?? 0} min={-50} max={100} step={5}
                    onChange={(v) => setter((s) => ({ ...s, demand_pct: v }))} format={pct} />
                  <LabSlider label="Lead time" value={val.lead_delta_days ?? 0} min={-5} max={30} step={1}
                    onChange={(v) => setter((s) => ({ ...s, lead_delta_days: v }))} format={days} />
                  <LabSlider label="Home allocation" value={val.home_allocation ?? 100} min={40} max={100} step={5}
                    onChange={(v) => setter((s) => ({ ...s, home_allocation: v }))} format={(v) => `${v}%`} />
                  <LabSlider label="Capacity" value={val.capacity_factor ?? 100} min={60} max={120} step={5}
                    onChange={(v) => setter((s) => ({ ...s, capacity_factor: v }))} format={(v) => `${v}%`} />
                </div>
                <div className="mt-3">
                  <Select
                    value=""
                    onChange={(e) => {
                      const p = PRESETS.find((x) => x.name === e.target.value);
                      if (p) setter({ ...p.inputs });
                    }}
                    aria-label={`Load preset into ${title}`}
                    className="w-full"
                  >
                    <option value="">Load a preset…</option>
                    {PRESETS.filter((p) => p.name !== "Baseline").map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </Select>
                </div>
              </div>
            ))}
          </div>

          {runCompare && (cmp.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : cmp.isError ? (
            <ErrorState message="Comparison failed." onRetry={() => cmp.refetch()} />
          ) : cmp.data ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-[11px] uppercase tracking-wider text-ink/40">
                    <th className="py-2 pr-3 font-medium">Metric</th>
                    {cmp.data.rows[0]?.values.map((v) => (
                      <th key={v.label} className="py-2 pr-3 font-medium">{v.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cmp.data.rows.map((row) => {
                    const base = row.values[0]?.raw;
                    return (
                      <tr key={row.metric} className="border-b border-ink/[0.06]">
                        <td className="py-2 pr-3 text-ink/60">{row.metric}</td>
                        {row.values.map((cell, i) => (
                          <td key={cell.label} className={`py-2 pr-3 font-medium tabular-nums ${
                            i > 0 && base !== undefined && cell.raw > base * 1.001 ? "text-red-400"
                            : i > 0 && base !== undefined && cell.raw < base * 0.999 ? "text-emerald-400"
                            : "text-ink"}`}
                          >
                            {cell.display}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-ink/40">Red / green = higher / lower than Current. Higher is not always worse — required inventory rises when you promise more service.</p>
            </div>
          ) : null)}
        </CardBody>
      </Card>
    </div>
  );
}
