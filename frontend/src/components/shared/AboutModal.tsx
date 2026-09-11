// "About This Analysis" — the recruiter-facing explainer: business problem,
// what the platform does, and the business value it delivers. Concise.
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { EASE } from "../motion";

export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="About this analysis">
      <motion.div className="absolute inset-0 bg-chrome/60 backdrop-blur-sm" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} />
      <motion.div
        className="relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-surface p-6 shadow-float"
        initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: EASE }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-ink">About This Analysis</h2>
          <button onClick={onClose} aria-label="Close"
            className="rounded-full bg-ink/5 p-1.5 text-ink/50 transition-colors hover:bg-ink/10 focus:outline-none focus:ring-2 focus:ring-brand-500/40">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <Section title="The business problem">
          Inventory imbalance loses money in two directions at once:
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li><strong>Stock-outs</strong> — demand arrives before replenishment; sales and customers are lost.</li>
            <li><strong>Overstock</strong> — cash sits in slow-moving stock while holding costs accrue (~20% of unit cost per year in this demo's assumptions).</li>
          </ul>
          Both come from the same blind spot: the gap between <em>how long stock lasts</em> and <em>how long replenishment takes</em>.
        </Section>

        <Section title="What this platform does">
          SupplyChainIQ analyzes operational data (sales, inventory ledger, suppliers, purchase orders) and recommends:
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li><strong>What</strong> to order — products projected below safety stock before replenishment arrives</li>
            <li><strong>When</strong> — reorder points from actual demand variability and supplier lead times</li>
            <li><strong>How much</strong> — EOQ-derived quantities floored by cycle cover</li>
            <li><strong>From whom</strong> — risk-adjusted supplier scoring, not just the cheapest quote</li>
          </ul>
        </Section>

        <Section title="Business value">
          Better inventory visibility · reduced stock-out exposure · improved supplier selection ·
          better demand planning · lower excess inventory and holding cost. Every number is computed
          from the database — this demo contains <strong>no hardcoded metrics</strong>.
        </Section>

        <p className="mt-4 rounded-xl bg-panel/70 px-3 py-2 text-[11px] leading-relaxed text-ink/50">
          Methods are deliberately explainable: safety stock Z×σ×√LT, backtested forecasts with disclosed
          accuracy (MAE/RMSE/MAPE), and a weighted supplier scorecard (delivery 30% · quality 25% · cost 25% · reliability 20%).
          Holding and ordering costs are demo assumptions, editable in Settings.
        </p>
      </motion.div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/40">{title}</h3>
      <div className="mt-1 text-xs leading-relaxed text-ink/70">{children}</div>
    </div>
  );
}
