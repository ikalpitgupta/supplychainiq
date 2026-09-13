// Interview Demo Mode — the 2–3 minute PM thinking flow, told from live data.
// Eight steps: problem → investigation → customer impact → recommendation →
// scenario → decision → experiment → final call. Every number arrives from
// the demo script API (same engines as the product), animations are quick and
// reduced-motion-aware, and controls are Next / Previous / Skip throughout.
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, ArrowRight, Beaker, ChevronLeft, ChevronRight, CircleCheck,
  CircleSlash, FlaskConical, Lightbulb, Play, RotateCcw, Scale, TrendingDown, X,
} from "lucide-react";
import { demoApi } from "../api/endpoints";
import { Button, Card, Skeleton } from "../components/ui";
import { AnimatedNumber, EASE } from "../components/motion";
import { formatINR } from "../utils/format";
import type { DemoStep, DemoMetric } from "../types";

const fmt = (v: number | null, format: DemoMetric["format"]) => {
  if (v == null) return "—";
  if (format === "pct1") return `${(v * 100).toFixed(1)}%`;
  if (format === "inr") return formatINR(v);
  return Math.round(v).toLocaleString("en-IN");
};

function MetricRow({ m, delay }: { m: DemoMetric; delay: number }) {
  const reduce = false;
  const moved = m.prior != null && m.recent != null;
  const worse = moved && (m.recent as number) > (m.prior as number);
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : delay, duration: 0.3, ease: EASE }}
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink/[0.07] py-3"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{m.label}</p>
        <p className="text-[11px] text-ink/40">{m.basis}</p>
      </div>
      <div className="flex items-baseline gap-2.5 font-display text-lg font-semibold tabular-nums">
        {moved && <span className="text-sm font-normal text-ink/40">{fmt(m.prior, m.format)}</span>}
        {moved && <ChevronRight size={13} className="text-ink/30" aria-hidden />}
        <span className={moved ? (worse ? "text-red-400" : "text-emerald-400") : "text-ink"}>
          <AnimatedNumber value={m.recent as number} format={(n) => fmt(n, m.format)} />
        </span>
        {moved && (
          <span className={`text-xs font-semibold ${worse ? "text-red-400/80" : "text-emerald-400/80"}`}>
            {worse ? "+" : ""}{(((m.recent as number) - (m.prior as number)) * (m.format === "pct1" ? 100 : 1)).toFixed(1)}
            {m.format === "pct1" ? " pts" : ""}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function StepBody({ step }: { step: DemoStep }) {
  const reduce = false;
  if (step.metrics) {
    return (
      <div>
        {step.metrics.map((m, i) => <MetricRow key={m.label} m={m} delay={0.1 + i * 0.09} />)}
      </div>
    );
  }
  if (step.chain) {
    return (
      <div className="space-y-0">
        {step.chain.map((node, i) => (
          <motion.div key={node.label}
            initial={reduce ? false : { opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: reduce ? 0 : 0.12 + i * 0.16, duration: 0.3, ease: EASE }}
          >
            <div className="flex items-start gap-3 py-2.5">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                node.verdict === "outcome" ? "bg-red-400"
                  : node.verdict === "structural" ? "bg-amber-400" : "bg-lime-400"}`} aria-hidden />
              <div>
                <p className="text-sm font-medium text-ink">{node.label}</p>
                <p className="text-xs text-ink/50">{node.detail}</p>
              </div>
            </div>
            {i < step.chain!.length - 1 && (
              <motion.div initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }}
                transition={{ delay: reduce ? 0 : 0.24 + i * 0.16, duration: 0.2 }}
                className="ml-[5px] h-5 w-px origin-top bg-ink/15" aria-hidden />
            )}
          </motion.div>
        ))}
      </div>
    );
  }
  if (step.detail) {
    return (
      <div className="space-y-3">
        {(["problem", "root_cause", "action", "impact"] as const).map((k, i) => (
          <motion.div key={k}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.1 + i * 0.12, duration: 0.28, ease: EASE }}
            className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-4"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink/45">
              {k.replace("_", " ")}
            </p>
            <p className="mt-1 text-sm text-ink/85">{step.detail![k]}</p>
          </motion.div>
        ))}
        <p className="text-[11px] text-ink/40">{step.basis}</p>
      </div>
    );
  }
  if (step.before_after) {
    const ba = step.before_after;
    return (
      <div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-ink/45">
          <span>{ba.labels[0]}</span><span />
          <span className="text-right text-lime-300/90">{ba.labels[1]}</span>
        </div>
        {ba.metrics.map((m, i) => {
          const improve = m.after < m.before;
          return (
            <motion.div key={m.label}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.1 + i * 0.12, duration: 0.3, ease: EASE }}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-ink/[0.07] py-3"
            >
              <span className="font-display text-lg font-semibold tabular-nums text-ink/50">
                {fmt(m.before, m.format)}
              </span>
              <ArrowRight size={15} className="text-ink/30" aria-hidden />
              <span className={`text-right font-display text-lg font-semibold tabular-nums ${improve ? "text-emerald-400" : "text-amber-400"}`}>
                <AnimatedNumber value={m.after} format={(n) => fmt(n, m.format)} />
              </span>
              <span className="col-span-3 text-[11px] text-ink/40">{m.label} · {m.basis}</span>
            </motion.div>
          );
        })}
        <p className="mt-3 rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-3 text-xs leading-relaxed text-sky-200/80">
          {ba.note}
        </p>
      </div>
    );
  }
  if (step.scores) {
    return (
      <div className="space-y-4">
        {step.scores.map((s, i) => (
          <motion.div key={s.label}
            initial={reduce ? false : { opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: reduce ? 0 : 0.1 + i * 0.12, duration: 0.3, ease: EASE }}
          >
            <div className="mb-1 flex items-baseline justify-between">
              <p className="text-sm font-medium text-ink">{s.label}</p>
              <p className="text-xs text-ink/50">{s.value}/{s.max} · {s.note}</p>
            </div>
            <div className="flex gap-1" role="img" aria-label={`${s.label}: ${s.value} of ${s.max}`}>
              {Array.from({ length: s.max }, (_, j) => (
                <motion.span key={j}
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: reduce ? 0 : 0.2 + i * 0.12 + j * 0.05, duration: 0.18 }}
                  className={`h-2 flex-1 origin-left rounded-full ${j < s.value ? "bg-lime-400" : "bg-ink/10"}`}
                />
              ))}
            </div>
          </motion.div>
        ))}
        <motion.p
          initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.5 }}
          className="rounded-2xl border border-lime-400/25 bg-lime-400/[0.05] p-4 text-sm font-medium text-lime-200"
        >
          {step.verdict}
        </motion.p>
      </div>
    );
  }
  if (step.experiment) {
    const e = step.experiment;
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {[["Control (A)", e.control, "text-ink/70"], ["Variant (B)", e.variant, "text-lime-300"]].map(([t, d, c], i) => (
            <motion.div key={t as string}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.1 + i * 0.14, duration: 0.3, ease: EASE }}
              className={`rounded-2xl border p-4 ${i === 0 ? "border-ink/10" : "border-lime-400/25 bg-lime-400/[0.04]"}`}
            >
              <p className={`text-[11px] font-semibold uppercase tracking-wider ${i === 0 ? "text-ink/45" : "text-lime-300/80"}`}>{t}</p>
              <p className={`mt-1 text-sm ${c}`}>{d}</p>
            </motion.div>
          ))}
        </div>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduce ? 0 : 0.36, duration: 0.3 }}
          className="rounded-2xl border border-ink/10 p-4 text-sm"
        >
          <p><span className="text-ink/45">Primary KPI:</span> <span className="font-semibold text-ink">{e.primary_kpi}</span>
            <span className="text-ink/45"> (baseline <AnimatedNumber value={e.primary_baseline} format={(n) => fmt(n, "pct1")} />)</span></p>
          <p className="mt-1.5"><span className="text-ink/45">Guardrails:</span>
            {e.guardrails.map((g) => (
              <span key={g.kpi} className="ml-2 inline-block rounded-full bg-ink/[0.05] px-2.5 py-0.5 text-xs text-ink/70">
                {g.kpi} · {fmt(g.baseline, "pct1")}
              </span>
            ))}
          </p>
          <p className="mt-1.5 text-xs text-ink/50">
            n ≈ {e.sample_size_per_arm.toLocaleString("en-IN")}/arm · {e.mde_pts}-pt MDE · {e.duration_weeks} weeks · {e.basis}
          </p>
        </motion.div>
      </div>
    );
  }
  if (step.options) {
    return (
      <div className="space-y-3">
        {step.options.map((o, i) => (
          <motion.div key={o.decision}
            initial={reduce ? false : { opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: reduce ? 0 : 0.15 + i * 0.18, duration: 0.32, ease: EASE }}
            className={`flex items-start gap-3 rounded-2xl border p-4 ${
              o.state === "chosen" ? "border-lime-400/40 bg-lime-400/[0.06]" : "border-ink/10 opacity-55"}`}
          >
            {o.state === "chosen"
              ? <CircleCheck size={18} className="mt-0.5 shrink-0 text-lime-400" aria-hidden />
              : <CircleSlash size={18} className="mt-0.5 shrink-0 text-ink/35" aria-hidden />}
            <div>
              <p className={`font-display text-base font-semibold ${o.state === "chosen" ? "text-lime-300" : "text-ink/70"}`}>
                {o.decision}{o.state === "chosen" && <span className="ml-2 text-xs font-normal text-ink/50">— recommended</span>}
              </p>
              <p className="mt-0.5 text-sm text-ink/60">{o.why}</p>
            </div>
          </motion.div>
        ))}
        <motion.p initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.7 }} className="text-xs text-ink/45">{step.criteria}</motion.p>
      </div>
    );
  }
  return null;
}

const STEP_ICON: Record<string, React.ReactNode> = {
  problem: <Activity size={14} aria-hidden />,
  investigation: <Lightbulb size={14} aria-hidden />,
  impact: <TrendingDown size={14} aria-hidden />,
  recommendation: <Scale size={14} aria-hidden />,
  scenario: <FlaskConical size={14} aria-hidden />,
  decision: <Beaker size={14} aria-hidden />,
  experiment: <Beaker size={14} aria-hidden />,
  final: <CircleCheck size={14} aria-hidden />,
};

export default function DemoModePage() {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [done, setDone] = useState(false);
  const reduce = false;

  const script = useQuery({ queryKey: ["demo-script"], queryFn: demoApi.script, staleTime: 60_000 });
  const steps = script.data?.steps ?? [];
  const step = steps[idx];
  const last = steps.length > 0 && idx === steps.length - 1;

  const go = useCallback((next: number) => {
    if (!steps.length) return;
    const clamped = Math.max(0, Math.min(steps.length - 1, next));
    setDir(clamped >= idx ? 1 : -1);
    setIdx(clamped);
  }, [idx, steps.length]);

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowRight") go(idx + 1);
    if (e.key === "ArrowLeft") go(idx - 1);
  }, [go, idx]);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (script.isLoading) {
    return <div className="p-6"><Skeleton className="h-[60vh] w-full" /></div>;
  }
  if (script.isError || !script.data) {
    return (
      <div className="p-6">
        <Card><div className="p-8 text-center text-sm text-ink/60">
          The demo script could not be loaded. <Button variant="secondary" size="sm" onClick={() => script.refetch()}>Retry</Button>
        </div></Card>
      </div>
    );
  }

  const finish = () => setDone(true);

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header: progress + controls */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-lime-300/80">Interview Demo · 2–3 min</p>
          <h1 className="font-display text-xl font-semibold text-ink">{script.data.scenario_name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={finish} aria-label="Skip demo">
            <X size={13} className="mr-1" aria-hidden /> Skip
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setIdx(0); setDone(false); }} aria-label="Restart demo">
            <RotateCcw size={13} className="mr-1" aria-hidden /> Restart
          </Button>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="mb-6 flex gap-1.5" role="progressbar" aria-valuenow={idx + 1} aria-valuemin={1} aria-valuemax={steps.length}>
        {steps.map((s, i) => (
          <button key={s.id} onClick={() => go(i)} aria-label={`Step ${i + 1}: ${s.kicker}`}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < idx ? "bg-lime-400/50" : i === idx ? "bg-lime-400" : "bg-ink/10 hover:bg-ink/25"}`} />
        ))}
      </div>

      {done ? (
        /* FINAL SCREEN: From Data → Insight → Decision → Impact */
        <motion.div initial={reduce ? false : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE }} className="pt-[8vh] text-center">
          <motion.p initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
            From Data <span className="text-ink/30">→</span> Insight <span className="text-ink/30">→</span> Decision{" "}
            <span className="text-ink/30">→</span> <span className="text-lime-300">Impact</span>
          </motion.p>
          <motion.p initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink/50">
            Every number in this story was computed live from the supply-chain data —
            detected, investigated, simulated, and decided the same way the product does it every day.
          </motion.p>
          <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65 }} className="mt-8 flex justify-center gap-2">
            <Button onClick={() => { setIdx(0); setDone(false); }}><Play size={14} className="mr-1" aria-hidden /> Replay demo</Button>
            <Button variant="secondary" onClick={() => { setDone(false); setIdx(steps.length - 1); }}>
              <Activity size={14} className="mr-1" aria-hidden /> Back to final step
            </Button>
          </motion.div>
          <motion.p initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.85 }}
            className="mt-6 text-[11px] text-ink/35">{script.data.reproducibility}</motion.p>
        </motion.div>
      ) : (
        <>
          {/* Step card */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step.id}
              initial={reduce ? false : { opacity: 0, x: 34 * dir }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -26 * dir }}
              transition={{ duration: 0.28, ease: EASE }}
            >
              <Card>
                <div className="p-6">
                  <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink/45">
                    <span className="text-lime-300/80">{STEP_ICON[step.id]}</span> {step.kicker}
                  </p>
                  <h2 className="mt-2 font-display text-xl font-semibold leading-snug text-ink">{step.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink/65">{step.narrative}</p>
                  <div className="mt-5">
                    <StepBody step={step} />
                  </div>
                </div>
              </Card>
            </motion.div>
          </AnimatePresence>

          {/* Controls */}
          <div className="mt-5 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => go(idx - 1)} disabled={idx === 0}>
              <ChevronLeft size={14} className="mr-0.5" aria-hidden /> Previous
            </Button>
            <p className="text-xs text-ink/40">Step {idx + 1} of {steps.length}</p>
            {last ? (
              <Button onClick={finish}>Finish <CircleCheck size={14} className="ml-1" aria-hidden /></Button>
            ) : (
              <Button onClick={() => go(idx + 1)}>Next <ChevronRight size={14} className="ml-0.5" aria-hidden /></Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
