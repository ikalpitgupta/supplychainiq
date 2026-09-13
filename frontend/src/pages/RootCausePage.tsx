// Root Cause Analysis — the flagship "don't just tell me the metric changed,
// help me understand why" view.
//
// Layout per problem: Problem → Evidence → interactive investigation tree →
// Contributing Factor → Business Impact → Recommended Action. Tree nodes are
// clickable and reveal their supporting metrics. Verdict language follows the
// engine's causal discipline: associated with / likely contributor / potential
// contributor; "primary driver" appears only when the decomposition accounts
// for the movement.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown, CircleCheck, CircleHelp, GitBranch, Lightbulb, Network, Search,
  TrendingDown, Wallet,
} from "lucide-react";
import { rcaApi } from "../api/endpoints";
import { Badge, Card, CardBody, CardHeader, ErrorState, SkeletonCard } from "../components/ui";
import { PageHeader } from "../components/shared";
import { EASE, Stagger, StaggerItem } from "../components/motion";
import type { RcaMetric, RcaProblem, RcaTreeNode } from "../types";

export default function RootCausePage() {
  const [days, setDays] = useState(21);
  const q = useQuery({ queryKey: ["rca-analysis", days], queryFn: () => rcaApi.analysis(days) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Root Cause Analysis"
        subtitle="The engine investigates contributing factors behind material metric movements — evidence first, causal language only where the data supports it."
        right={
          <div className="flex gap-1" role="group" aria-label="Investigation window">
            {[14, 21, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${days === d ? "bg-brand-50 text-brand-700" : "text-ink/50 hover:bg-ink/10"}`}>
                {d}d
              </button>
            ))}
          </div>
        }
      />

      {q.isError && (
        <Card><ErrorState message={(q.error as Error)?.message || "Failed to load root cause analysis"} onRetry={() => q.refetch()} /></Card>
      )}

      {q.isLoading && (
        <div className="space-y-4">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={8} />
        </div>
      )}

      {q.data && (q.data.problems.length === 0 ? (
        <Card>
          <CardBody className="flex items-center gap-3 py-8">
            <CircleCheck className="h-5 w-5 text-emerald-500" />
            <div>
              <p className="text-sm font-semibold text-ink">No material movements in the last {days} days</p>
              <p className="text-xs text-ink/50">The detector only surfaces changes above a noise threshold — silence here means the network is holding steady.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Stagger className="space-y-8" stagger={0.06}>
          {q.data.problems.map((p) => <ProblemInvestigation key={p.id} p={p} />)}
        </Stagger>
      ))}

      {q.data && (
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink/40">
          <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {q.data.language_note}
        </p>
      )}
    </div>
  );
}

/* ------------------------- one problem investigation --------------------- */

function ProblemInvestigation({ p }: { p: RcaProblem }) {
  return (
    <StaggerItem>
      <section aria-label={p.title} className="space-y-4">
        {/* Problem */}
        <Card>
          <CardBody className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone="red" dot>{p.area}</Badge>
                <h2 className="font-display text-base font-semibold text-ink">{p.title}</h2>
              </div>
              <div className="flex items-center gap-3 font-display text-sm">
                <span className="text-ink/40">late rate {formatVal(p.prior, p.seeding)}</span>
                <TrendingDown className="h-4 w-4 text-red-500" />
                <span className="font-semibold text-red-600">{formatVal(p.recent, p.seeding)}</span>
                {p.delta_pts != null && <Badge tone="red">{p.delta_pts > 0 ? "+" : ""}{p.delta_pts} pts</Badge>}
              </div>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink/60">{p.statement}</p>
          </CardBody>
        </Card>

        <div className="grid gap-4 xl:grid-cols-5">
          {/* Investigation tree */}
          <Card className="xl:col-span-3">
            <CardHeader
              title="Investigation tree — click a factor for its evidence"
              subtitle="Every branch is measured on the same now-vs-prior basis; flagged branches moved materially."
              icon={<Network className="h-4 w-4" />}
            />
            <CardBody className="space-y-1.5">
              <TreeNode node={{ id: "problem", label: p.title, status: "flagged", summary: p.statement, metrics: [], children: p.tree }}
                root />
            </CardBody>
          </Card>

          {/* Verdict column — cascades after the tree: evidence → factor → impact → action */}
          <Stagger className="space-y-4 xl:col-span-2" delay={0.2}>
            {p.evidence && (
              <StaggerItem>
                <Card>
                  <CardHeader title="Evidence" subtitle={p.evidence.headline} icon={<Search className="h-4 w-4" />} />
                  <CardBody className="space-y-1.5">
                    {p.evidence.metrics.map((m) => <MetricRow key={m.label} m={m} />)}
                  </CardBody>
                </Card>
              </StaggerItem>
            )}

            <StaggerItem>
              <Card>
                <CardHeader title="Contributing factor" icon={<GitBranch className="h-4 w-4" />}
                  right={p.contributing_factor.confidence && <Badge tone={p.contributing_factor.confidence === "high" ? "green" : p.contributing_factor.confidence === "medium" ? "yellow" : "gray"}>{p.contributing_factor.confidence} confidence</Badge>} />
                <CardBody className="space-y-2">
                  <p className="text-sm font-semibold text-ink">{p.contributing_factor.factor}</p>
                  <Badge tone={p.contributing_factor.verdict.includes("primary driver") ? "red"
                    : p.contributing_factor.verdict.includes("likely") ? "yellow"
                    : p.contributing_factor.verdict.includes("requires") ? "gray" : "blue"} dot>
                    {p.contributing_factor.verdict}
                  </Badge>
                  <p className="text-xs leading-relaxed text-ink/70">{p.contributing_factor.impact}</p>
                </CardBody>
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card>
                <CardHeader title="Business impact" subtitle="Decomposition estimate — not a guarantee." icon={<Wallet className="h-4 w-4" />} />
                <CardBody>
                  <p className="text-xs leading-relaxed text-ink/70">{p.business_impact.statement}</p>
                </CardBody>
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card>
                <CardHeader title="Recommended action" icon={<Lightbulb className="h-4 w-4" />} />
                <CardBody>
                  <p className="rounded-xl bg-lime-500/10 px-3 py-2.5 text-xs leading-relaxed text-ink">{p.recommendation}</p>
                </CardBody>
              </Card>
            </StaggerItem>
          </Stagger>
        </div>
      </section>
    </StaggerItem>
  );
}

/* ------------------------------ tree node -------------------------------- */

function TreeNode({ node, root = false }: { node: RcaTreeNode; root?: boolean }) {
  const [open, setOpen] = useState(root);
  const flagged = node.status === "flagged";

  return (
    <div className={root ? "" : "ml-4 border-l border-ink/10 pl-3"}>
      <motion.button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors ${
          flagged ? "bg-red-500/5 hover:bg-red-500/10" : "hover:bg-ink/5"
        }`}
        initial={false}
        whileTap={{ scale: 0.995 }}
        aria-expanded={open}
      >
        {flagged
          ? <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
          : <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500/70" />}
        <span className="min-w-0 flex-1">
          <span className={`block text-xs font-semibold ${flagged ? "text-red-700 dark:text-red-400" : "text-ink/80"}`}>{node.label}</span>
          {!root && <span className="mt-0.5 block text-[11px] leading-relaxed text-ink/50">{node.summary}</span>}
        </span>
        <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/30 transition-transform ${open ? "rotate-180" : ""}`} />
      </motion.button>
      <AnimatePresence initial={false}>
        {open && node.metrics.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mb-2 ml-4 mt-1 space-y-1 rounded-xl bg-panel/70 px-3 py-2">
              {node.metrics.map((m, i) => {
                const metric = m as unknown as RcaMetric;
                if (metric.label && metric.prior !== undefined) {
                  return <MetricRow key={i} m={metric} />;
                }
                // Carrier-candidate rows (per-carrier late rates).
                const c = m as unknown as { carrier: string; prior_late_rate: number; recent_late_rate: number; delta_pts: number; verdict?: string };
                if (c.carrier) {
                  return (
                    <div key={i} className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="text-ink/70">{c.carrier}{c.verdict ? ` — ${c.verdict}` : ""}</span>
                      <span className="font-mono text-ink/50">
                        {(c.prior_late_rate * 100).toFixed(1)}% → {(c.recent_late_rate * 100).toFixed(1)}%
                        <span className={c.delta_pts > 0 ? "ml-2 text-red-600" : "ml-2 text-emerald-600"}>{c.delta_pts > 0 ? "+" : ""}{c.delta_pts} pts</span>
                      </span>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {open && node.children.map((child, ci) => (
        <motion.div key={child.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.06 + ci * 0.07, duration: 0.24, ease: EASE }}
        >
          <TreeNode node={child} />
        </motion.div>
      ))}
    </div>
  );
}

function MetricRow({ m }: { m: RcaMetric }) {
  const worse = m.delta.startsWith("+") && !m.label.toLowerCase().includes("on-time")
    || m.delta.startsWith("-") && m.label.toLowerCase().includes("on-time");
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-ink/70">{m.label}</span>
      <span className="font-mono text-ink/50">
        {m.prior} → {m.recent}
        <span className={`ml-2 ${worse ? "text-red-600" : "text-emerald-600"}`}>{m.delta}</span>
      </span>
    </div>
  );
}

function formatVal(v: number, seeding: string): string {
  if (seeding === "dispatch") return `${v}h`;
  return `${(v * 100).toFixed(1)}%`;
}
