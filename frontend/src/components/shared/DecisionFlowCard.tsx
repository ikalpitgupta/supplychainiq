// Decision-engine flow: each reasoning step reveals in sequence (<2s total),
// then the recommendation lands. Reduced motion shows everything instantly.
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { ArrowDown, ClipboardList, Check } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader } from "../ui";
import { WhyModal } from "./WhyModal";
import { EASE } from "../motion";
import { formatINR } from "../../utils/format";
import type { ProductDetail, RiskTier } from "../../types";

const TIER_TONE: Record<RiskTier, "green" | "yellow" | "red" | "violet"> = {
  LOW: "green", MEDIUM: "yellow", HIGH: "red", CRITICAL: "red",
};

export function DecisionFlowCard({ d, onCreatePo }: {
  d: ProductDetail;
  onCreatePo: () => void;
}) {
  const reduce = false;
  const [whyOpen, setWhyOpen] = useState(false);
  const decision = d.decision;
  const m = d.metrics;

  const steps = useMemo(() => ([
    { label: "Current inventory", value: `${m.current_stock.toLocaleString("en-IN")} units` },
    { label: "Demand analysis", value: `${m.avg_daily_demand.toFixed(1)} units/day · σ ${m.demand_std.toFixed(1)}` },
    { label: "Lead time", value: `${d.lead_time_days} days` },
    {
      label: "Risk calculation",
      value: `${decision.risk_tier} — stock-out in ${m.days_to_zero !== null ? m.days_to_zero.toFixed(0) : "—"}d vs ${d.lead_time_days}d lead`,
    },
  ]), [m, d, decision]);

  const stepDelay = (i: number) => (reduce ? 0 : 0.15 + i * 0.35);
  const revealDelay = reduce ? 0 : 0.15 + steps.length * 0.35;

  const showFlow = decision.action === "ORDER NOW" || decision.action === "REORDER SOON" || decision.action === "MONITOR";

  return (
    <Card>
      <CardHeader
        title="Decision engine"
        subtitle="How the recommendation is derived — step by step"
        right={<Badge tone={TIER_TONE[decision.risk_tier]} dot>{decision.risk_tier}</Badge>}
      />
      <CardBody>
        {!showFlow ? (
          <p className="text-xs leading-relaxed text-ink/60">{decision.reason}</p>
        ) : (
          <div className="space-y-0">
            {steps.map((s, i) => (
              <motion.div
                key={s.label}
                className="flex items-center gap-3"
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: stepDelay(i), duration: 0.3, ease: EASE }}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chrome text-[10px] font-bold text-lime-300">
                  {i + 1}
                </span>
                <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 rounded-xl bg-panel/70 px-3 py-2">
                  <p className="text-xs text-ink/60">{s.label}</p>
                  <p className="text-xs font-semibold text-ink">{s.value}</p>
                </div>
                {i < steps.length - 1 && <ArrowDown className="absolute" style={{ display: "none" }} aria-hidden />}
              </motion.div>
            ))}

            <motion.div
              className="mt-3 rounded-2xl border border-brand-500/20 bg-brand-500/5 p-4"
              initial={reduce ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: revealDelay, duration: 0.35, ease: EASE }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600">Recommendation</p>
                  <p className="mt-0.5 font-display text-2xl font-semibold text-ink">
                    {decision.action.replace(/_/g, " ")}
                  </p>
                  <p className="mt-1 text-xs text-ink/60">
                    Order <strong className="text-ink">{decision.recommended_quantity.toLocaleString("en-IN")} units</strong>
                    {" "}· {decision.preferred_supplier ?? "Supplier unavailable"}
                    {decision.recommended_quantity > 0 && (
                      <> · est. {formatINR(decision.recommended_quantity * d.unit_cost)}</>
                    )}
                  </p>
                  {decision.impact.risk_movement !== "Low → Low" && (
                    <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                      Estimated impact: {decision.impact.risk_movement} · protects ≈ {formatINR(decision.impact.revenue_protected)} (estimate)
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Button variant="lime" size="sm" onClick={onCreatePo}>
                    <ClipboardList className="h-3.5 w-3.5" /> Create Purchase Order
                  </Button>
                  <button
                    onClick={() => setWhyOpen(true)}
                    className="text-[11px] font-medium text-brand-600 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 rounded"
                    aria-label="Why this recommendation?"
                  >
                    ⓘ Why this recommendation?
                  </button>
                </div>
              </div>

              {/* Supplier options: risk-adjusted comparison */}
              {decision.supplier_options.length > 1 && (
                <div className="mt-3 space-y-1.5 border-t border-ink/10 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Supplier comparison</p>
                  {decision.supplier_options.map((o, i) => (
                    <motion.div
                      key={o.supplier_id}
                      className="flex items-start justify-between gap-3 rounded-xl bg-surface px-3 py-2"
                      initial={reduce ? false : { opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: revealDelay + 0.15 + i * 0.12, duration: 0.25 }}
                    >
                      <div className="flex items-start gap-2">
                        {i === 0 && <Check className="mt-0.5 h-3.5 w-3.5 text-emerald-500" aria-label="recommended" />}
                        <div>
                          <p className="text-xs font-semibold text-ink">
                            {o.name}
                            {i === 0 && <span className="ml-1.5 text-[10px] font-medium text-emerald-600">recommended</span>}
                          </p>
                          <p className="text-[10px] leading-relaxed text-ink/50">{o.trade_off}</p>
                        </div>
                      </div>
                      <Badge tone={o.risk_level === "Low" ? "green" : o.risk_level === "Medium" ? "yellow" : "red"}>
                        {o.on_time_rate.toFixed(0)}% on-time
                      </Badge>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </CardBody>
      <WhyModal
        open={whyOpen}
        onClose={() => setWhyOpen(false)}
        title={decision.why.title}
        steps={decision.why.steps}
        verdict={decision.why.verdict}
      />
    </Card>
  );
}
