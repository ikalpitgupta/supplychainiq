// Shared domain components used across pages — flux design language, theme-aware.
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, InfoTip } from "../ui";
import type { BadgeTone } from "../ui";
import { formatDelta } from "../../utils/format";
import { AnimatedNumber } from "../motion";
import type { InventoryStatus, RecommendationAction, RiskLevel, Severity } from "../../types";

export function PageHeader({ title, subtitle, right }:
  { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink/50">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: InventoryStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
      <span className={`h-2 w-2 rounded-full ${
        status === "Healthy" ? "bg-emerald-500" : status === "Low Stock" ? "bg-amber-400"
        : status === "Critical" ? "bg-red-500" : "bg-violet-500"}`} aria-hidden />
      {status}
    </span>
  );
}

const riskTone: Record<RiskLevel, BadgeTone> = {
  High: "red", Medium: "yellow", Low: "green", None: "gray",
};
export function RiskBadge({ level }: { level: RiskLevel }) {
  return <BadgePill tone={riskTone[level]}>{level} risk</BadgePill>;
}

const actionTone: Record<RecommendationAction, BadgeTone> = {
  "NO ACTION": "gray", MONITOR: "blue", "REORDER SOON": "yellow",
  "ORDER NOW": "red", "REDUCE FUTURE ORDERS": "violet", "REVIEW SUPPLIER": "yellow",
};
export function ActionBadge({ action }: { action: RecommendationAction }) {
  return <BadgePill tone={actionTone[action]}>{action}</BadgePill>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const map: Record<Severity, { tone: BadgeTone; label: string }> = {
    critical: { tone: "red", label: "Critical" },
    warning: { tone: "yellow", label: "Warning" },
    opportunity: { tone: "violet", label: "Opportunity" },
    info: { tone: "gray", label: "Info" },
  };
  return <BadgePill tone={map[severity].tone} dot>{map[severity].label}</BadgePill>;
}

/** Theme-aware pill (light: tinted bg + strong text; dark: same tints read well). */
function BadgePill({ tone, children, dot = false }: { tone: BadgeTone; children: ReactNode; dot?: boolean }) {
  const styles: Record<BadgeTone, string> = {
    green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    yellow: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    red: "bg-red-500/10 text-red-600 dark:text-red-400",
    blue: "bg-brand-500/10 text-brand-700 dark:text-brand-300",
    gray: "bg-ink/5 text-ink/60",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  };
  const dotColor: Record<BadgeTone, string> = {
    green: "bg-emerald-500", yellow: "bg-amber-500", red: "bg-red-500",
    blue: "bg-brand-500", gray: "bg-ink/40", violet: "bg-violet-500",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColor[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}

/** Flux KPI card: icon chip, label, oversized display numeral, lime delta pill.
 *  Pass `numericValue` (+`format`) to get a count-up animation on load/change.
 *  Pass `onWhy` to render an "ⓘ Why?" explainability button. */
export function KpiCard({
  label, value, unit, changePct, info, accent = "ink", numericValue, format, onWhy,
}: {
  label: string;
  value: string;
  unit?: string;
  changePct?: number | null;
  info?: string;
  accent?: "ink" | "red" | "violet" | "yellow" | "green";
  numericValue?: number | null;
  format?: (n: number) => string;
  onWhy?: () => void;
}) {
  const delta = formatDelta(changePct);
  const hasDelta = changePct !== null && changePct !== undefined;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${
            accent === "red" ? "bg-red-500"
            : accent === "violet" ? "bg-violet-500"
            : accent === "yellow" ? "bg-amber-400"
            : accent === "green" ? "bg-emerald-500"
            : "bg-ink/30"}`} />
          <p className="text-xs font-medium text-ink/60">{label}</p>
        </div>
        {info && <InfoTip text={info} />}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        {numericValue != null ? (
          <AnimatedNumber value={numericValue} format={format} className="font-display text-3xl font-semibold tracking-tight text-ink" />
        ) : (
          <span className="font-display text-3xl font-semibold tracking-tight text-ink">{value}</span>
        )}
        {unit && <span className="text-xs text-ink/40">{unit}</span>}
      </div>
      {onWhy && (
        <button
          onClick={onWhy}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 transition-colors hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-1 rounded"
          aria-label={`Why is ${label} at this value?`}
        >
          ⓘ Why?
        </button>
      )}
      {hasDelta && (
        <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          delta.dir === "up" ? "bg-lime-300 text-chrome" : delta.dir === "down" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-ink/5 text-ink/50"
        }`}>
          {delta.dir === "up" ? <ArrowUpRight className="h-3 w-3" /> : delta.dir === "down" ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          {delta.text}
        </span>
      )}
      {!hasDelta && accent !== "ink" && (
        <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          accent === "red" ? "bg-red-500/15 text-red-600 dark:text-red-400"
          : accent === "violet" ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        }`}>
          {accent === "red" ? "action needed" : accent === "violet" ? "monitor" : "watch"}
        </span>
      )}
    </Card>
  );
}

/** Chart container that leads with the business question the chart answers. */
export function QuestionCard({
  question, explanation, children, height = 300, right, dark = false,
}: { question: string; explanation?: string; children: ReactNode; height?: number; right?: ReactNode; dark?: boolean }) {
  return (
    <Card className={dark ? "border border-white/10 bg-chrome text-white" : ""}>
      <div className={`flex items-start justify-between gap-4 px-5 pt-5 ${dark ? "text-white" : ""}`}>
        <div>
          <h3 className={`text-sm font-semibold ${dark ? "text-white" : "text-ink"}`}>{question}</h3>
          {explanation && <p className={`mt-0.5 text-xs ${dark ? "text-white/50" : "text-ink/50"}`}>{explanation}</p>}
        </div>
        {right}
      </div>
      <div className="px-3 pb-4 pt-3" style={{ height }}>
        {children}
      </div>
    </Card>
  );
}

export const CHART_COLORS = {
  primary: "#7a5ce8",
  lime: "#b5d81e",
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  violet: "#8b5cf6",
  ink: "#16170f",
  slate: "#94a3b8",
  grid: "rgba(22, 23, 15, 0.06)",
  darkGrid: "rgba(255, 255, 255, 0.08)",
};
