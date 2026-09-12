// "Run Demo Scenario" — walks the main business story: risk detected →
// forecast → stock-out probability → supplier comparison → selection →
// quantity → recommendation. Each step animates in; skippable at any point.
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, X } from "lucide-react";
import { Button } from "../ui";
import { EASE } from "../motion";

interface Step {
  title: string;
  body: string;
  cta?: { label: string; to: string };
}

const STEPS: Step[] = [
  {
    title: "1 · Inventory risk detected",
    body: "The engine projects every product's stock at its supplier's lead-time date. Products that fall below safety stock before replenishment arrives are flagged CRITICAL — for the seeded demo, Festive Kurta Set stocks out in 8 days against a 10-day lead time.",
  },
  {
    title: "2 · Demand forecast evaluated",
    body: "A backtested model (moving average / exponential smoothing — whichever wins on held-out error) projects lead-time demand, with MAE/RMSE/MAPE disclosed on the Forecast page.",
  },
  {
    title: "3 · Stock-out probability assessed",
    body: "Safety stock Z×σ×√(lead time) sets the buffer. Projected stock at arrival below that buffer means the order is already late — the risk tier quantifies exactly how late.",
  },
  {
    title: "4 · Suppliers compared",
    body: "Every supplier serving the category is scored: delivery 30% · quality 25% · cost 25% · reliability 20%. For critical items, reliability is weighted up — a cheaper but late embroiderer loses to a reliable one when the festive window is closing.",
  },
  {
    title: "5 · Optimal supplier selected",
    body: "The engine recommends the best risk-adjusted supplier and shows the trade-off in one sentence — so a costlier but reliable choice is explainable, not arbitrary.",
  },
  {
    title: "6 · Order quantity calculated",
    body: "EOQ balances ordering vs holding cost; the quantity is floored so it always covers lead-time demand plus a review buffer, and never goes negative.",
  },
  {
    title: "7 · Purchase recommendation generated",
    body: "The final packet: action, quantity, supplier, estimated cost, the full WHY breakdown, and the estimated impact — ready to convert into a purchase order.",
    cta: { label: "Open Insights & Actions", to: "/insights" },
  },
];

export function DemoTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) { setIdx(0); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const step = STEPS[idx];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Demo scenario">
      <motion.div className="absolute inset-0 bg-chrome/60 backdrop-blur-sm" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} />
      <motion.div
        className="relative w-full max-w-md rounded-3xl bg-chrome p-6 text-white shadow-float"
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-lime-300">Demo scenario</p>
          <button onClick={onClose} aria-label="Skip demo"
            className="rounded-full bg-white/10 p-1.5 text-white/70 transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-lime-300/60">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <motion.div key={idx} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: EASE }}>
          <h2 className="mt-2 font-display text-lg font-semibold">{step.title}</h2>
          <p className="mt-2 text-xs leading-relaxed text-white/70">{step.body}</p>
        </motion.div>

        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`Step ${idx + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-lime-300" : "w-1.5 bg-white/25"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="!text-white/60 hover:!bg-white/10" onClick={onClose}>
              Skip
            </Button>
            {step.cta ? (
              <Button variant="lime" size="sm" onClick={() => { onClose(); navigate(step.cta!.to); }}>
                {step.cta.label} <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button variant="lime" size="sm" onClick={() => setIdx((i) => i + 1)}>
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
