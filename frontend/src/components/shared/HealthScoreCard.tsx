// Supply Chain Health Score — animated ring gauge + explainable components.
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { Activity } from "lucide-react";
import { Card, CardBody, CardHeader } from "../ui";
import { WhyModal } from "./WhyModal";
import type { WhyStep } from "./WhyModal";
import type { DashboardData } from "../../types";
import { AnimatedNumber, EASE } from "../motion";

export function HealthScoreCard({ data }: { data: DashboardData["health_score"] }) {
  const reduce = useReducedMotion();
  const [whyOpen, setWhyOpen] = useState(false);
  const R = 52;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, data.total)) / 100;
  const color = data.total >= 85 ? "#059669" : data.total >= 70 ? "#65a30d" : data.total >= 55 ? "#d97706" : "#dc2626";

  const steps: WhyStep[] = (Object.entries(data.components) as [
    keyof DashboardData["health_score"]["components"],
    DashboardData["health_score"]["components"][keyof DashboardData["health_score"]["components"]],
  ][]).map(([name, c]) => ({
    label: `${name[0].toUpperCase()}${name.slice(1)} (${Math.round(c.weight * 100)}%)`,
    value: `${Math.round(c.score)} × ${c.weight.toFixed(2)} = ${c.contribution.toFixed(1)} pts`,
    note: c.detail,
  }));

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Supply Chain Health Score"
        subtitle="Weighted composite — click to see the full calculation"
        icon={<Activity className="h-4 w-4" />}
        right={
          <button
            onClick={() => setWhyOpen(true)}
            className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-1 rounded"
            aria-label="Why is the health score at this level?"
          >
            ⓘ Why?
          </button>
        }
      />
      <CardBody className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="relative" aria-label={`Health score ${Math.round(data.total)} of 100, grade ${data.grade}`}>
          <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-hidden>
            <circle cx="64" cy="64" r={R} fill="none" stroke="currentColor" className="text-ink/8" strokeWidth="10" />
            <motion.circle
              cx="64" cy="64" r={R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={C}
              initial={{ strokeDashoffset: reduce ? C * (1 - pct) : C }}
              animate={{ strokeDashoffset: C * (1 - pct) }}
              transition={{ duration: reduce ? 0 : 1.0, ease: EASE, delay: reduce ? 0 : 0.3 }}
              transform="rotate(-90 64 64)"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <AnimatedNumber value={data.total} format={(n) => String(Math.round(n))} className="font-display text-3xl font-semibold text-ink" />
            <span className="text-[10px] text-ink/40">/ 100 · {data.grade}</span>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-x-3 gap-y-1.5">
          {(Object.entries(data.components) as [
            HealthComponentName,
            DashboardData["health_score"]["components"][HealthComponentName],
          ][]).map(([name, c]) => (
            <div key={name} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-ink/50 capitalize">{name}</span>
              <span className="font-semibold text-ink">{Math.round(c.score)}</span>
            </div>
          ))}
        </div>
      </CardBody>
      <WhyModal
        open={whyOpen} onClose={() => setWhyOpen(false)}
        title="Why this health score?"
        steps={steps}
        verdict={`Weighted sum of the six components above = ${data.total}/100 (${data.grade}).`}
      >
        <p className="mt-3 text-[10px] text-ink/40">
          Weights: inventory 25% · stock-out 25% · suppliers 20% · forecasting 15% · overstock 10% · procurement 5%. Missing data scores a neutral 70.
        </p>
      </WhyModal>
    </Card>
  );
}

type HealthComponentName = keyof DashboardData["health_score"]["components"];
