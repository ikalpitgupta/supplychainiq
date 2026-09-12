// Decision packet card — one structured PM initiative: problem → opportunity →
// solution → RICE → experiment → decision → business impact. Collapsible; the
// header row always shows quadrant, RICE score, and decision state.
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Beaker, ChevronDown, CircleSlash, FlaskConical, Gauge, Lightbulb, Rocket, Scale, Target, Users,
} from "lucide-react";
import { Badge, Button, Card, CardBody } from "../ui";
import type { PmInitiative } from "../../types";

const STATE_STYLE: Record<string, { tone: "green" | "yellow" | "gray"; icon: React.ReactNode }> = {
  ship: { tone: "green", icon: <Rocket className="h-3.5 w-3.5" /> },
  run_experiment: { tone: "yellow", icon: <FlaskConical className="h-3.5 w-3.5" /> },
  reject: { tone: "gray", icon: <CircleSlash className="h-3.5 w-3.5" /> },
};

const QUADRANT_TONE: Record<string, "green" | "blue" | "gray" | "red"> = {
  "Quick win": "green",
  "Big bet": "blue",
  "Fill-in": "gray",
  "Reconsider": "red",
};

export function DecisionPacketCard({ i, defaultOpen = false }: { i: PmInitiative; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const qKey = Object.keys(QUADRANT_TONE).find((k) => i.rice.quadrant.startsWith(k)) ?? "Fill-in";
  const state = STATE_STYLE[i.decision.state] ?? STATE_STYLE.run_experiment;
  const e = i.experiment;

  return (
    <Card>
      <CardBody className="py-4">
        {/* Header row — always visible */}
        <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left" aria-expanded={open}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={QUADRANT_TONE[qKey]} dot>{i.rice.quadrant}</Badge>
            <span className="font-display text-sm font-semibold text-ink">{i.title}</span>
            <Badge tone="gray">{i.area}</Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink/50">RICE {Math.round(i.rice.score).toLocaleString()}</span>
            <Badge tone={state.tone}>{state.icon} {i.decision.state === "run_experiment" ? "experiment" : i.decision.state}</Badge>
            <ChevronDown className={`h-4 w-4 text-ink/30 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </button>

        <p className="mt-2 text-xs leading-relaxed text-ink/70"><strong className="text-ink">Problem:</strong> {i.problem_statement}</p>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-4 border-t border-ink/10 pt-3">
                {/* Source insight + solution */}
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl bg-panel/70 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Source insight (live data)</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink/70">{i.source_insight}</p>
                  </div>
                  <div className="rounded-xl bg-lime-500/10 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink/40"><Lightbulb className="h-3 w-3" /> Solution</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink">{i.solution}</p>
                  </div>
                </div>

                {/* Opportunity */}
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink/40"><Users className="h-3 w-3" /> Opportunity</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MiniStat label="Affected orders (90d)" value={i.opportunity.affected_orders_90d.toLocaleString()} />
                    <MiniStat label="Affected products" value={i.opportunity.affected_products != null ? String(i.opportunity.affected_products) : "network-wide"} />
                    <MiniStat label="Revenue exposure" value={i.opportunity.revenue_exposure != null ? `₹${Math.round(i.opportunity.revenue_exposure / 1000)}K` : "—"} />
                    <MiniStat label="Customer impact" value={i.opportunity.customer_impact} small />
                  </div>
                  <p className="mt-1 text-[10px] text-ink/40">Basis: {i.opportunity.basis}</p>
                </div>

                {/* RICE breakdown */}
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink/40"><Gauge className="h-3 w-3" /> RICE — {Math.round(i.rice.score).toLocaleString()} = reach × impact × confidence ÷ effort</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MiniStat label="Reach" value={`${i.rice.reach.toLocaleString()} orders`} />
                    <MiniStat label="Impact /order" value={String(i.rice.impact)} />
                    <MiniStat label="Confidence" value={`${Math.round(i.rice.confidence * 100)}%`} />
                    <MiniStat label="Effort" value={`${i.rice.effort_weeks} person-weeks`} />
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-ink/40">Confidence: {i.rice.confidence_basis} · Effort: {i.rice.effort_basis}</p>
                </div>

                {/* Experiment */}
                {e ? (
                  <div className="rounded-xl border border-ink/10 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink/40"><Beaker className="h-3 w-3" /> Experiment design — {e.duration_weeks}-week test, n ≈ {e.sample_size_per_arm.toLocaleString()} per arm</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink"><strong>Hypothesis:</strong> {e.hypothesis}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg bg-panel/70 px-2.5 py-2">
                        <p className="text-[10px] font-semibold uppercase text-ink/40">Control</p>
                        <p className="text-xs text-ink/70">{e.control}</p>
                      </div>
                      <div className="rounded-lg bg-brand-50 px-2.5 py-2">
                        <p className="text-[10px] font-semibold uppercase text-brand-700">Variant</p>
                        <p className="text-xs text-ink/70">{e.variant}</p>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1.5 text-xs">
                      <p className="flex items-start gap-2"><Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                        <span><strong className="text-ink">Primary KPI:</strong> {e.primary_kpi.name}
                          {e.primary_kpi.baseline != null && <> — baseline {(e.primary_kpi.baseline * 100).toFixed(1)}%, MDE {e.primary_kpi.mde_pts} pts</>}
                        </span>
                      </p>
                      <p><strong className="text-ink">Secondary:</strong> {e.secondary_kpis.join(" · ")}</p>
                      <p className="text-ink/70"><strong className="text-ink">Guardrails:</strong> {e.guardrail_kpis.join(" · ")}</p>
                      <p className="text-[10px] leading-relaxed text-ink/40">{e.sizing_note}</p>
                    </div>
                  </div>
                ) : (
                  <p className="rounded-xl bg-panel/70 px-3 py-2 text-xs text-ink/50">No experiment designed — see the decision reason.</p>
                )}

                {/* Decision */}
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink/40"><Scale className="h-3 w-3" /> Decision</p>
                  <div className="mt-1.5 rounded-xl bg-panel/70 px-3 py-2.5">
                    <p className="text-sm font-semibold text-ink">{i.decision.label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink/70">{i.decision.reason}</p>
                    <div className="mt-2 grid gap-2 text-[11px] leading-relaxed sm:grid-cols-3">
                      <p><strong className="text-emerald-700">Ship if:</strong> <span className="text-ink/60">{i.decision.ship_criteria}</span></p>
                      <p><strong className="text-amber-700">Iterate if:</strong> <span className="text-ink/60">{i.decision.iterate_criteria}</span></p>
                      <p><strong className="text-red-700">Reject if:</strong> <span className="text-ink/60">{i.decision.reject_criteria}</span></p>
                    </div>
                  </div>
                </div>

                {/* Business impact */}
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink/40"><Rocket className="h-3 w-3" /> Business impact & trade-off</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {Object.entries(i.business_impact.levers).map(([lever, note]) => (
                      <span key={lever} className="rounded-full border border-ink/10 bg-panel/70 px-2.5 py-1 text-[11px] text-ink/70">
                        <strong className="capitalize text-ink">{lever}:</strong> {note}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink/60"><strong className="text-ink">Trade-off:</strong> {i.business_impact.trade_off}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardBody>
    </Card>
  );
}

function MiniStat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-ink/40">{label}</p>
      <p className={`font-semibold text-ink ${small ? "text-[11px] leading-snug" : "font-display text-sm"}`}>{value}</p>
    </div>
  );
}

export function DecisionLayerSection() {
  return null; // placeholder; the page composes queries itself
}

export { DecisionPacketCard as default };
export function PacketFooterButton({ onClick }: { onClick: () => void }) {
  return <Button variant="ghost" size="sm" onClick={onClick}>Expand all</Button>;
}
