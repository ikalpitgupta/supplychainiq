import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Download, Plus } from "lucide-react";
import { poApi } from "../api/endpoints";
import { downloadCsv } from "../api/client";
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Input, Pagination, SkeletonRows, Table, TD, TH, THead, TR, Tabs } from "../components/ui";
import { PageHeader } from "../components/shared";
import { CreatePODialog } from "../components/shared/CreatePODialog";
import { formatDate, formatINR, formatNumber } from "../utils/format";
import { useToast } from "../hooks/useToast";
import type { POListItem, POStatus } from "../types";

const statusTone = (s: string) =>
  s === "Delivered" ? "green" : s === "Delayed" ? "red" : s === "Cancelled" ? "gray" : s === "Draft" ? "gray" : "blue";

export default function PurchaseOrdersPage() {
  const [params, setParams] = useSearchParams();
  const { push } = useToast();
  const page = Number(params.get("page") ?? 1);
  const status = params.get("status") ?? "All";
  const search = params.get("search") ?? "";
  const [searchInput, setSearchInput] = useState(search);
  const [detail, setDetail] = useState<POListItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFor, setCreateFor] = useState<number | undefined>(
    params.get("create") ? Number(params.get("create")) : undefined,
  );
  const [statusUpdate, setStatusUpdate] = useState<{ po: POListItem; next: string } | null>(null);

  const q = useQuery({
    queryKey: ["purchase-orders", { page, status, search }],
    queryFn: () => poApi.list({ page, page_size: 15, status: status === "All" ? undefined : status, search: search || undefined }),
  });

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
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Track every replenishment order from draft to delivery."
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
                    <TH>PO Number</TH><TH>Product</TH><TH>Supplier</TH>
                    <TH className="text-right">Quantity</TH><TH>Ordered</TH><TH>Expected</TH><TH>Actual</TH>
                    <TH>Status</TH><TH className="text-right">Total Cost</TH>
                  </TR>
                </THead>
                <tbody>
                  {q.data.items.map((po) => (
                    <TR key={po.id} onClick={() => setDetail(po)}>
                      <TD className="font-medium text-brand-700">{po.po_number}</TD>
                      <TD className="text-ink/70">{po.product}</TD>
                      <TD className="text-ink/50">{po.supplier}</TD>
                      <TD className="text-right">{formatNumber(po.quantity)}</TD>
                      <TD className="text-ink/50">{formatDate(po.order_date)}</TD>
                      <TD className="text-ink/50">{formatDate(po.expected_date)}</TD>
                      <TD className="text-ink/50">{formatDate(po.actual_date)}</TD>
                      <TD>
                        <Badge tone={statusTone(po.status)} dot>
                          {po.status}{po.days_late ? ` (+${po.days_late}d)` : ""}
                        </Badge>
                      </TD>
                      <TD className="text-right text-ink/70">{formatINR(po.total_cost)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={15} total={q.data.total} onPage={(p) => setParam("page", String(p))} />
            </>
          )
        )}
      </Card>

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
