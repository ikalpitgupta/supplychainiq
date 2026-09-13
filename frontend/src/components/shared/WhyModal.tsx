// "Why?" modal — the explainability surface for every KPI and recommendation.
// Receives a structured packet (steps with labels/values) and a verdict line.
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { EASE } from "../motion";

export interface WhyStep {
  label: string;
  value: number | string | null;
  unit?: string;
  note?: string;
}

export function WhyModal({ open, onClose, title, steps, verdict, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  steps: WhyStep[];
  verdict?: string;
  children?: React.ReactNode; // optional extra content (e.g. supplier trade-offs)
}) {
  const reduce = false;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const fmt = (v: WhyStep["value"]) =>
    v === null || v === undefined ? "—"
      : typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 1 })
      : v;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <motion.div
        className="absolute inset-0 bg-chrome/60 backdrop-blur-sm"
        onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.15 }}
      />
      <motion.div
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-surface p-5 shadow-float"
        initial={reduce ? false : { opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close explanation"
            className="rounded-full bg-ink/5 p-1.5 text-ink/50 transition-colors hover:bg-ink/10 focus:outline-none focus:ring-2 focus:ring-brand-500/40">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <ol className="mt-4 space-y-2">
          {steps.map((s, i) => (
            <motion.li
              key={s.label}
              className="flex items-center justify-between gap-3 rounded-xl bg-panel/70 px-3 py-2"
              initial={reduce ? false : { opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduce ? 0 : 0.06 * i, duration: 0.2 }}
            >
              <div>
                <p className="text-xs text-ink/70">{s.label}</p>
                {s.note && <p className="text-[10px] text-ink/40">{s.note}</p>}
              </div>
              <p className="whitespace-nowrap font-display text-sm font-semibold text-ink">
                {fmt(s.value)}{s.unit ? <span className="ml-1 text-[10px] font-normal text-ink/40">{s.unit}</span> : null}
              </p>
            </motion.li>
          ))}
        </ol>

        {verdict && (
          <p className="mt-4 rounded-xl bg-lime-300/20 px-3 py-2 text-xs font-medium leading-relaxed text-ink">
            {verdict}
          </p>
        )}
        {children}
      </motion.div>
    </div>
  );
}
