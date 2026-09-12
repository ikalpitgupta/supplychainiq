import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ClipboardList, Download, TrendingDown, TrendingUp, Wrench } from "lucide-react";
import { WhyModal } from "../components/shared/WhyModal";
import { recommendationsApi } from "../api/endpoints";
import { downloadCsv } from "../api/client";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, InfoTip, Skeleton, Tabs } from "../components/ui";
import { ActionBadge, PageHeader, SeverityBadge } from "../components/shared";
import { CreatePODialog } from "../components/shared/CreatePODialog";
import { formatDays, formatINR, formatNumber } from "../utils/format";
import { useToast } from "../hooks/useToast";
import type { Recommendation, Severity } from "../types";

const GROUPS = [
  { id: "critical", label: "Critical", blurb: "Immediate action required" },
  { id: "warning", label: "Warning", blurb: "Action recommended soon" },
  { id: "opportunity", label: "Opportunity", blurb: "Potential optimization" },
  { id: "info", label: "Healthy", blurb: "No action needed" },
];

const severityIcon = (s: Severity) =>
  s === "critical" ? <TrendingUp className="h-4 w-4 text-red-500" />
    : s === "opportunity" ? <TrendingDown className="h-4 w-4 text-violet-500" />
      : s === "warning" ? <Wrench className="h-4 w-4 text-amber-500" />
        : null;

export default function RecommendationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("group") ?? "critical";
  const [poFor, setPoFor] = useState<number | undefined>();
  const [whyFor, setWhyFor] = useState<Recommendation | undefined>();
  const { push } = useToast();

  const q = useQuery({ queryKey: ["recommendations"], queryFn: recommendationsApi.get });

  const setGroup = (g: string) => setParams({ group: g }, { replace: true });

  const items = (q.data?.items ?? []).filter((r) => r.severity === tab);

  return (
    <div>
      <PageHeader
        title="Insights & Actions"
        subtitle="The decision center — what to order, when, how much, and from whom."
        right={
          <Button variant="secondary" size="sm" onClick={async () => {
            try { await downloadCsv("recommendations"); push("success", "Recommendations CSV exported"); }
            catch (e) { push("error", e instanceof Error ? e.message : "Export failed"); }
          }}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        }
      />

      {q.isError && <Card><ErrorState message={(q.error as Error)?.message || "Failed to load recommendations"} onRetry={() => q.refetch()} /></Card>}

      {q.isLoading && <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>}

      {q.data && (
        <>
          <div className="mb-4">
            <Tabs
              tabs={GROUPS.map((g) => ({ id: g.id, label: g.label, count: q.data!.counts[g.id as keyof typeof q.data.counts] }))}
              active={tab}
              onChange={setGroup}
            />
            <p className="mt-2 text-xs text-ink/50">
              {GROUPS.find((g) => g.id === tab)?.blurb}
              <InfoTip text="Every recommendation is computed from live inventory math: reorder point, safety stock, stock-out projection and EOQ order quantities — then translated into a plain-English reason." />
            </p>
          </div>

          {q.data.supplier_reviews.length > 0 && tab === "critical" && (
            <Card className="mb-4">
              <CardHeader title="Supplier reviews" subtitle="Delivery performance trending below baseline" icon={<Wrench className="h-4 w-4" />} />
              <CardBody className="space-y-2">
                {q.data.supplier_reviews.map((r) => (
                  <div key={r.supplier_id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                    <div className="flex items-start gap-2.5">
                      <SeverityBadge severity={r.severity} />
                      <div>
                        <p className="text-xs font-semibold text-ink">{r.supplier} — {r.action}</p>
                        <p className="mt-0.5 max-w-2xl text-xs text-ink/70">{r.reason}</p>
                      </div>
                    </div>
                    <Link to={`/suppliers/${r.supplier_id}`}><Button variant="secondary" size="sm">View Supplier</Button></Link>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          {items.length === 0 ? (
            <Card><EmptyState title={`No ${tab} recommendations`} message="Everything in this group is currently within policy." /></Card>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {items.map((r: Recommendation) => (
                <Card key={r.product_id}>
                  <CardBody>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        {severityIcon(r.severity)}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Link to={`/products/${r.product_id}`} className="text-sm font-semibold text-ink hover:text-brand-700">
                              {r.product}
                            </Link>
                            <ActionBadge action={r.action} />
                          </div>
                          <p className="mt-0.5 text-xs text-ink/35">{r.sku} · {r.category} · lead time {r.lead_time_days}d</p>
                        </div>
                      </div>
                      <Badge tone={r.risk_tier === "CRITICAL" ? "red" : r.risk_tier === "HIGH" ? "red" : r.risk_tier === "MEDIUM" ? "yellow" : "green"} dot>
                        {r.risk_tier}
                      </Badge>
                    </div>

                    <p className="mt-3 rounded-lg bg-ink/5 p-3 text-xs leading-relaxed text-ink/70">
                      <strong className="text-ink">Why:</strong> {r.reason}
                      <button
                        onClick={() => setWhyFor(r)}
                        className="ml-2 inline-flex items-center text-[11px] font-semibold text-brand-600 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 rounded"
                        aria-label={`Show the full calculation for ${r.product}`}
                      >
                        ⓘ Full calculation
                      </button>
                    </p>

                    {r.impact.risk_movement !== "Low → Low" && (
                      <p className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400">
                        Estimated impact: {r.impact.risk_movement} · protects ≈ {formatINR(r.impact.revenue_protected)} (estimate)
                      </p>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                      <div><p className="text-ink/50">Current stock</p><p className="font-semibold text-ink">{formatNumber(r.current_stock)}</p></div>
                      <div><p className="text-ink/50">Reorder point</p><p className="font-semibold text-ink">{formatNumber(Math.round(r.reorder_point))}</p></div>
                      <div><p className="text-ink/50">Days of inventory</p><p className="font-semibold text-ink">{formatDays(r.days_of_inventory)}</p></div>
                      <div><p className="text-ink/50">Recommended order</p><p className="font-semibold text-brand-700">{formatNumber(r.recommended_quantity)} units</p></div>
                      <div><p className="text-ink/50">Preferred supplier</p><p className="font-semibold text-ink">{r.preferred_supplier || "—"}</p></div>
                      <div><p className="text-ink/50">Supplier score</p><p className="font-semibold text-ink">{r.preferred_supplier_score ? `${r.preferred_supplier_score.toFixed(0)}/100` : "—"}</p></div>
                      <div><p className="text-ink/50">Est. order cost</p><p className="font-semibold text-ink">{formatINR(r.estimated_cost)}</p></div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.action !== "REDUCE FUTURE ORDERS" && (
                        <Button size="sm" onClick={() => setPoFor(r.product_id)}>
                          <ClipboardList className="h-3.5 w-3.5" /> Create PO
                        </Button>
                      )}
                      <Link to={`/products/${r.product_id}`}><Button variant="secondary" size="sm">View Product</Button></Link>
                      {r.preferred_supplier_id && (
                        <Link to={`/suppliers/${r.preferred_supplier_id}`}><Button variant="secondary" size="sm">View Supplier</Button></Link>
                      )}
                      <Link to={`/forecast?product=${r.product_id}`}><Button variant="ghost" size="sm">View Forecast</Button></Link>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <CreatePODialog open={poFor !== undefined} onClose={() => setPoFor(undefined)} productId={poFor} />
      <WhyModal
        open={!!whyFor}
        onClose={() => setWhyFor(undefined)}
        title={whyFor?.why.title ?? ""}
        steps={whyFor?.why.steps ?? []}
        verdict={whyFor?.why.verdict}
      >
        {whyFor && whyFor.supplier_options.length > 1 && (
          <div className="mt-3 border-t border-ink/10 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Why this supplier?</p>
            {whyFor.supplier_options.map((o, i) => (
              <div key={o.supplier_id} className="mt-1.5 flex items-start justify-between gap-3 rounded-xl bg-panel/70 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-ink">{o.name}{i === 0 && <span className="ml-1.5 text-[10px] text-emerald-600">recommended</span>}</p>
                  <p className="text-[10px] leading-relaxed text-ink/50">{o.trade_off}</p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-ink/70">{o.adjusted_score}</span>
              </div>
            ))}
          </div>
        )}
      </WhyModal>
    </div>
  );
}
