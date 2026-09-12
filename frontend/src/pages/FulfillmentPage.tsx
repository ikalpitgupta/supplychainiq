import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, Download, Plus, Timer } from "lucide-react";
import { outboundApi, poApi } from "../api/endpoints";
import { downloadCsv } from "../api/client";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Dialog, EmptyState, ErrorState, Input, Pagination, SkeletonRows, Table, TD, TH, THead, TR, Tabs } from "../components/ui";
import { PageHeader } from "../components/shared";
import { CreatePODialog } from "../components/shared/CreatePODialog";
import { formatDate, formatINR, formatNumber } from "../utils/format";
import { useToast } from "../hooks/useToast";
import type { POListItem, POStatus } from "../types";

const statusTone = (s: string) =>
  s === "Delivered" ? "green" : s === "Delayed" ? "red" : s === "Cancelled" ? "gray" : s === "Draft" ? "gray" : "blue";

export default function FulfillmentPage() {
  const [params, setParams] = useSearchParams();
  const { push } = useToast();
  const page = Number(params.get("page") ?? 1);
  const status = params.get("status") ?? "All";
  const search = params.get("search") ?? "";
  const [searchInput, setSearchInput] = useState(search);
  const [detail, setDetail] = useState<POListItem | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFor, setCreateFor] = useState<number | undefined>(
    params.get("create") ? Number(params.get("create")) : undefined,
  );
  const [statusUpdate, setStatusUpdate] = useState<{ po: POListItem; next: string } | null>(null);

  const q = useQuery({
    queryKey: ["purchase-orders", { page, status, search }],
    queryFn: () => poApi.list({ page, page_size: 15, status: status === "All" ? undefined : status, search: search || undefined }),
  });

  // Outbound customer-order fulfillment: pick → pack → dispatch bottleneck.
  const bottleneckQ = useQuery({ queryKey: ["outbound-bottleneck"], queryFn: () => outboundApi.bottleneck(30) });
  const bn = bottleneckQ.data;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== "All") next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  const tabs = [{ id: "All", label: "All", count: q.data ? Object.values(q.data.status_counts).reduce((a, b) => a + b, 0) : undefined }]
    .concat(["In Transit", "Pending", "Delayed", "Delivered", "Draft", "Ordered", "Cancelled"].map((s) => ({
      id: s, label: s, count: q.data?.status_counts[s],
    })));

  const confirmStatus = async () => {
    if (!statusUpdate) return;
    try {
      await poApi.updateStatus(statusUpdate.po.id, statusUpdate.next);
      push("success", `${statusUpdate.po.po_number} marked ${statusUpdate.next}`);
      setStatusUpdate(null);
      q.refetch();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fulfillment"
        subtitle="Customer-order flow (pick → pack → dispatch) and the replenishment pipeline behind it."
        right={
          <>
            <Button variant="secondary" size="sm" onClick={async () => {
              try { await downloadCsv("purchase-orders"); push("success", "Purchase orders CSV exported"); }
              catch (e) { push("error", e instanceof Error ? e.message : "Export failed"); }
            }}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Create PO
            </Button>
          </>
        }
      />

      {/* Outbound fulfillment intelligence — where do customer orders slow down? */}
      {bn && (
        <Card>
          <CardHeader
            icon={<Timer size={15} aria-hidden />}
            title="Where do customer orders slow down?"
            subtitle={bn.total_cycle_hours
              ? `Average order-to-dispatch cycle: ${bn.total_cycle_hours}h across ${bn.orders} orders (last ${bn.window_days} days). Bottleneck: ${bn.bottleneck}.`
              : "Stage timings from customer orders in the window."}
          />
          <CardBody>
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-ink/10" role="img"
                  aria-label={`Cycle time split: ${bn.stages.map((s) => `${s.stage} ${s.share_pct}%`).join(", ")}`}>
                  {bn.stages.map((s, i) => (
                    <div key={s.stage}
                      className={i === 0 ? "bg-brand-500" : i === 1 ? "bg-amber-400" : "bg-red-400"}
                      style={{ width: `${s.share_pct}%` }}
                      title={`${s.stage}: ${s.avg_hours}h`} />
                  ))}
                </div>
                <div className="space-y-1.5">
                  {bn.stages.map((s, i) => (
                    <div key={s.stage} className="flex items-center justify-between rounded-xl border border-ink/10 px-3 py-2 text-xs">
                      <span className="flex items-center gap-2 font-medium text-ink">
                        <span className={`h-2 w-2 rounded-full ${i === 0 ? "bg-brand-500" : i === 1 ? "bg-amber-400" : "bg-red-400"}`} aria-hidden />
                        {s.stage}
                        {s.stage === bn.bottleneck && <Badge tone="red">bottleneck</Badge>}
                      </span>
                      <span className="text-ink/60">{s.avg_hours}h avg · {s.share_pct}% of cycle</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink/40">By warehouse</p>
                <div className="space-y-1.5">
                  {bn.by_warehouse.map((w) => (
                    <div key={w.warehouse} className="flex items-center justify-between rounded-xl border border-ink/10 px-3 py-2 text-xs">
                      <span className="font-medium text-ink">{w.warehouse}</span>
                      <span className="text-ink/60">
                        pick {w.pick_hours}h · pack {w.pack_hours}h · <strong className={w.dispatch_hours > 15 ? "text-red-500" : "text-ink"}>dispatch {w.dispatch_hours}h</strong>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink/10 p-4">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setParam("search", searchInput); }}
            onBlur={() => setParam("search", searchInput)}
            placeholder="Search PO number — press Enter"
            className="max-w-xs"
            aria-label="Search purchase orders"
          />
        </div>
        <div className="border-b border-ink/10 px-4 py-3">
          <Tabs tabs={tabs} active={status} onChange={(id) => setParam("status", id)} />
        </div>

        {q.isError && <ErrorState message={(q.error as Error)?.message || "Failed to load purchase orders"} onRetry={() => q.refetch()} />}
        {q.isLoading && <SkeletonRows rows={9} />}

        {q.data && (
          q.data.items.length === 0 ? (
            <EmptyState
              title="No purchase orders here"
              message={status !== "All" ? `No POs with status "${status}".` : "Create your first purchase order."}
              action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> Create PO</Button>}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>PO</TH><TH>Product</TH><TH>Supplier</TH>
                    <TH>Delivery risk</TH><TH className="text-right">Value at stake</TH>
                    <TH className="w-8" aria-label="Expand row" />
                  </TR>
                </THead>
                <tbody>
                  {q.data.items.map((po) => {
                    const atRisk = po.status === "Delayed" || po.days_late > 0;
                    const expanded = expandedId === po.id;
                    return (
                      <Fragment key={po.id}>
                        <TR
                          onClick={() => setExpandedId(expanded ? null : po.id)}
                          className={atRisk ? "bg-red-500/[0.04]" : undefined}
                        >
                          <TD className="font-medium text-brand-700">{po.po_number}</TD>
                          <TD className="text-ink/70">{po.product}</TD>
                          <TD className="text-ink/50">{po.supplier}</TD>
                          <TD>
                            <Badge tone={statusTone(po.status)} dot>
                              {po.status}{po.days_late ? ` (+${po.days_late}d)` : ""}
                            </Badge>
                          </TD>
                          <TD className="text-right text-ink/70">{formatINR(po.total_cost)}</TD>
                          <TD>
                            <ChevronDown className={`h-3.5 w-3.5 text-ink/30 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
                          </TD>
                        </TR>
                        {expanded && (
                          <TR className="bg-ink/[0.02]">
                            <TD className="!p-0" />
                            <TD className="!py-3" colSpan={5}>
                              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                                <Detail label="Quantity" value={`${formatNumber(po.quantity)} units`} />
                                <Detail label="Unit cost" value={formatINR(po.unit_cost, false)} />
                                <Detail label="Ordered" value={formatDate(po.order_date)} />
                                <Detail label="Expected" value={formatDate(po.expected_date)} />
                                <Detail label="Actual" value={formatDate(po.actual_date)} />
                                <div className="flex items-end">
                                  <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setDetail(po); }}>
                                    Manage status
                                  </Button>
                                </div>
                              </div>
                              {atRisk && (
                                <p className="mt-2 text-[11px] text-red-500">
                                  This order slipped {po.days_late} day{po.days_late === 1 ? "" : "s"} past its expected date — every day late narrows stock cover downstream.
                                </p>
                              )}
                            </TD>
                          </TR>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={15} total={q.data.total} onPage={(p) => setParam("page", String(p))} />
            </>
          )
        )}
      </Card>

      <h2 className="border-t border-ink/10 pt-2 font-display text-sm font-semibold uppercase tracking-widest text-ink/70">
        Inbound · replenishment orders
      </h2>

      {/* Detail dialog with status actions */}
      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail ? `Purchase order ${detail.po_number}` : ""}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><p className="text-ink/50">Product</p><p className="font-semibold text-ink">{detail.product}</p></div>
              <div><p className="text-ink/50">Supplier</p><p className="font-semibold text-ink">{detail.supplier}</p></div>
              <div><p className="text-ink/50">Quantity</p><p className="font-semibold text-ink">{formatNumber(detail.quantity)} units</p></div>
              <div><p className="text-ink/50">Total cost</p><p className="font-semibold text-ink">{formatINR(detail.total_cost, false)}</p></div>
              <div><p className="text-ink/50">Order date</p><p className="font-semibold text-ink">{formatDate(detail.order_date)}</p></div>
              <div><p className="text-ink/50">Expected delivery</p><p className="font-semibold text-ink">{formatDate(detail.expected_date)}</p></div>
              <div><p className="text-ink/50">Actual delivery</p><p className="font-semibold text-ink">{formatDate(detail.actual_date)}</p></div>
              <div><p className="text-ink/50">Status</p><Badge tone={statusTone(detail.status)} dot>{detail.status}</Badge></div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink/70">Update status</p>
              <div className="flex flex-wrap gap-1.5">
                {(["Ordered", "In Transit", "Delivered", "Delayed", "Cancelled"] as POStatus[]).map((s) => (
                  <Button key={s} size="sm" variant={s === detail.status ? "primary" : "secondary"}
                    onClick={() => setStatusUpdate({ po: detail, next: s })}>
                    {s === detail.status ? `✓ ${s}` : s}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!statusUpdate}
        onClose={() => setStatusUpdate(null)}
        onConfirm={confirmStatus}
        title="Update purchase order status"
        message={statusUpdate ? `Mark ${statusUpdate.po.po_number} as "${statusUpdate.next}"? This is recorded immediately.` : ""}
        confirmLabel="Update status"
      />

      <CreatePODialog
        open={createOpen || createFor !== undefined}
        onClose={() => {
          setCreateOpen(false);
          setCreateFor(undefined);
          setParams((p) => { p.delete("create"); return p; }, { replace: true });
        }}
        productId={createFor}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink/40">{label}</p>
      <p className="mt-0.5 font-medium text-ink">{value}</p>
    </div>
  );
}
