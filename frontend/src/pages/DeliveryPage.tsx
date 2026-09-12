// Delivery page — inbound supplier delivery performance (the DELIVERY stage of
// the business journey). Everything is derived from real purchase-order data;
// the supplier-side story is the honest "delivery" view for a demo dataset
// with no outbound courier integration.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BadgeCheck, Clock, PackageCheck, Timer, TriangleAlert, Truck } from "lucide-react";
import { fulfillmentApi } from "../api/endpoints";
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton, Table, TD, TH, THead, TR } from "../components/ui";
import { PageHeader } from "../components/shared";
import { KpiCard } from "../components/shared";
import { Stagger, StaggerItem } from "../components/motion";
import { formatINR, formatNumber, formatPct } from "../utils/format";
import type { FulfillmentData } from "../types";

function MonthlyBars({ monthly }: { monthly: FulfillmentData["monthly"] }) {
  if (monthly.length === 0) return <p className="py-8 text-center text-sm text-ink/40">No purchase orders in this window.</p>;
  const max = Math.max(1, ...monthly.map((m) => m.orders));
  return (
    <div className="flex h-40 items-end gap-1.5">
      {monthly.map((m) => {
        const late = m.orders > 0 ? (m.late / m.orders) * 100 : 0;
        return (
          <div key={m.month} className="group flex min-w-0 flex-1 flex-col items-center gap-1" title={`${m.month}: ${m.orders} orders · ${m.late} late · ${formatINR(m.spend)}`}>
            <div className="flex h-32 w-full flex-col justify-end gap-0.5" aria-hidden>
              <div className="w-full rounded-t-sm bg-red-400/80" style={{ height: `${(m.late / max) * 100}%` }} />
              <div className="w-full bg-emerald-500/80" style={{ height: `${((m.orders - m.late) / max) * 100}%` }} />
            </div>
            <span className={`w-full truncate text-center text-[9px] ${late > 20 ? "font-bold text-red-500" : "text-ink/40"}`}>{m.month}</span>
          </div>
        );
      })}
      <div className="ml-2 hidden shrink-0 flex-col gap-1 text-[10px] text-ink/50 sm:flex" aria-hidden>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500/80" /> on-time</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-400/80" /> late</span>
      </div>
    </div>
  );
}

export default function DeliveryPage() {
  const q = useQuery({ queryKey: ["delivery"], queryFn: () => fulfillmentApi.summary(90) });
  const d = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery"
        subtitle="Inbound delivery performance — are suppliers delivering what was ordered, on time, at the agreed cost?"
        right={d && (
          <div className="rounded-2xl bg-surface px-4 py-2.5 shadow-card">
            <p className={`font-display text-xl font-semibold ${d.on_time_rate >= 0.85 ? "text-emerald-600 dark:text-emerald-400" : d.on_time_rate >= 0.7 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
              {formatPct(d.on_time_rate * 100)}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-ink/40">on-time rate · {d.period_days}d</p>
          </div>
        )}
      />

      {q.isError && (
        <Card><ErrorState message={(q.error as Error)?.message || "Failed to load delivery performance"} onRetry={() => q.refetch()} /></Card>
      )}

      {q.isLoading || !d ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StaggerItem>
              <KpiCard label="On-Time Delivery" value={formatPct(d.on_time_rate * 100)} accent={d.on_time_rate >= 0.85 ? "green" : d.on_time_rate >= 0.7 ? "yellow" : "red"}
                info="Delivered POs that arrived on or before the expected date (last 90 days)." />
            </StaggerItem>
            <StaggerItem>
              <KpiCard label="Avg Lead Time" value={d.avg_lead_time_days != null ? `${d.avg_lead_time_days.toFixed(1)}` : "—"} unit="days"
                info="Order date → actual delivery date, averaged across delivered POs." />
            </StaggerItem>
            <StaggerItem>
              <KpiCard label="Avg Delay (late POs)" value={d.avg_delay_days != null ? `+${d.avg_delay_days.toFixed(1)}` : "—"} unit="days"
                accent={d.avg_delay_days != null && d.avg_delay_days > 3 ? "red" : undefined}
                info="Average lateness across late deliveries in the window." />
            </StaggerItem>
            <StaggerItem>
              <KpiCard label="Purchase Spend" value={formatINR(d.spend_total)}
                info={`Total PO value in the window. Last 30d: ${formatINR(d.spend_30d)} (prev 30d: ${formatINR(d.spend_30d_prev)}).`} />
            </StaggerItem>
          </Stagger>

          <Card>
            <CardHeader icon={<Timer size={15} aria-hidden />} title="Where are delivery SLAs breaking?" subtitle="Order volume and lateness by month — red months need a supplier conversation." />
            <CardBody><MonthlyBars monthly={d.monthly} /></CardBody>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader
                icon={<TriangleAlert size={15} aria-hidden />}
                title="Which orders slipped, and by how much?"
                subtitle="These POs arrived after the expected date — each one pushed a replenishment back and narrowed stock cover."
              />
              <CardBody className="overflow-x-auto">
                {d.late_orders.length === 0 ? (
                  <p className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-6 text-sm text-emerald-600 dark:text-emerald-400">
                    <BadgeCheck size={16} aria-hidden /> Every delivered PO arrived on time in this window.
                  </p>
                ) : (
                  <Table>
                    <THead><TR><TH>PO</TH><TH>Product</TH><TH>Supplier</TH><TH className="text-right">Days late</TH></TR></THead>
                    <tbody>
                      {d.late_orders.slice(0, 10).map((po) => (
                        <TR key={po.id}>
                          <TD className="text-ink/50">{po.po_number}</TD>
                          <TD><Link to={`/products/${po.product_id}`} className="font-medium text-brand-700 hover:underline">{po.product}</Link></TD>
                          <TD><Link to={`/suppliers/${po.supplier_id}`} className="text-ink/70 hover:text-brand-700">{po.supplier}</Link></TD>
                          <TD className="text-right"><Badge tone={po.days_late > 5 ? "red" : "yellow"}>+{po.days_late}d</Badge></TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                icon={<Clock size={15} aria-hidden />}
                title="What stock is arriving, and when?"
                subtitle="Orders currently in flight — arriving stock that has not hit the ledger yet."
              />
              <CardBody className="overflow-x-auto">
                {d.inbound.length === 0 ? (
                  <p className="rounded-2xl border border-ink/10 px-4 py-6 text-sm text-ink/50">Nothing in transit right now.</p>
                ) : (
                  <Table>
                    <THead><TR><TH>PO</TH><TH>Product</TH><TH className="text-right">Qty</TH><TH>Expected</TH><TH>Status</TH></TR></THead>
                    <tbody>
                      {d.inbound.slice(0, 10).map((po) => (
                        <TR key={po.id}>
                          <TD className="text-ink/50">{po.po_number}</TD>
                          <TD><Link to={`/products/${po.product_id}`} className="font-medium text-brand-700 hover:underline">{po.product}</Link></TD>
                          <TD className="text-right">{formatNumber(po.quantity)}</TD>
                          <TD className="text-ink/50">{po.expected_date}</TD>
                          <TD><Badge tone={po.status === "Delayed" ? "red" : po.status === "In Transit" ? "blue" : "gray"} dot>{po.status}</Badge></TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              icon={<PackageCheck size={15} aria-hidden />}
              title="Price integrity"
              subtitle={d.price_variance_pct != null
                ? `PO unit costs ran ${d.price_variance_pct >= 0 ? "+" : ""}${d.price_variance_pct.toFixed(1)}% vs product master cost on average — purchase price variance.`
                : "Purchase price variance vs the product master cost."}
            />
            <CardBody className="flex items-center gap-3">
              <Truck size={18} className="text-ink/40" aria-hidden />
              <p className="text-xs leading-relaxed text-ink/60">
                Delivery is more than dates — what suppliers charge versus the agreed master cost is a direct margin leak.
                Deep-dive in <Link to="/intelligence" className="font-medium text-brand-600 hover:underline">Intelligence → Purchase price alerts</Link>.
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
