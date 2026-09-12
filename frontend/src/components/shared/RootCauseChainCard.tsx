// Interactive root-cause chain: Demand spike → inventory imbalance → … → SLA
// breach. Each node expands to show the measured evidence behind it. When the
// data does not support the chain, the card says so instead of pretending.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ChevronDown, CircleCheck, Workflow } from "lucide-react";
import { outboundApi } from "../../api/endpoints";
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton } from "../ui";

export function RootCauseChainCard({ days = 30 }: { days?: number }) {
  const q = useQuery({ queryKey: ["outbound-root-cause", days], queryFn: () => outboundApi.rootCause(days) });
  const [openNode, setOpenNode] = useState<number | null>(0);

  return (
    <Card>
      <CardHeader
        icon={<Workflow size={15} aria-hidden />}
        title="Why are deliveries late? The full causal chain"
        subtitle={q.data?.available
          ? `Traced from live data — click any step to see the evidence (${q.data.window_days}d window).`
          : "Each step is shown only when the numbers support it."}
        right={q.data?.headline && (
          <div className="text-right">
            <p className="font-display text-xl font-semibold text-ink">{q.data.headline.late_rate_pct}%</p>
            <p className="text-[10px] uppercase tracking-wider text-ink/40">late · {q.data.headline.delivered} delivered</p>
          </div>
        )}
      />
      <CardBody>
        {q.isLoading && <Skeleton className="h-48 w-full" />}
        {q.isError && <ErrorState message="Failed to load the causal chain." onRetry={() => q.refetch()} />}
        {q.data && !q.data.available && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-5">
            <CircleCheck size={18} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-ink">No causal chain right now — and that is the honest answer.</p>
              <p className="mt-1 text-xs leading-relaxed text-ink/60">{q.data.message}</p>
            </div>
          </div>
        )}
        {q.data?.available && (
          <ol className="space-y-0">
            {q.data.chain.map((node, i) => {
              const open = openNode === i;
              return (
                <li key={node.node}>
                  <button
                    onClick={() => setOpenNode(open ? null : i)}
                    aria-expanded={open}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                      open ? "border-brand-500/40 bg-brand-500/[0.06]" : "border-ink/10 hover:bg-ink/[0.04]"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chrome text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{node.node}</span>
                        <span className={`block truncate text-xs ${open ? "text-ink/70" : "text-ink/40"}`}>{node.evidence}</span>
                      </span>
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-ink/30 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {i < q.data.chain.length - 1 && (
                    <div className="flex justify-center py-0.5" aria-hidden>
                      <ArrowDown className="h-3.5 w-3.5 text-ink/25" />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {q.data?.warehouse_shares && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-ink/10 pt-3">
            {Object.entries(q.data.warehouse_shares).map(([code, s]) => (
              <Badge key={code} tone={s.share_pct < 18 ? "red" : "gray"} dot>
                {code} ({s.region}) · {s.share_pct}% of stock
              </Badge>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
