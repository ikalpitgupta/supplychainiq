import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardList, Shirt } from "lucide-react";
import { productsApi } from "../api/endpoints";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, SkeletonCard, Table, TD, TH, THead, TR } from "../components/ui";
import { CHART_COLORS, KpiCard, PageHeader, StatusBadge } from "../components/shared";
import { DemandForecastChart, ProjectionChart, StockTrendChart } from "../components/charts";
import { CreatePODialog } from "../components/shared/CreatePODialog";
import { DecisionFlowCard } from "../components/shared/DecisionFlowCard";
import { Stagger, StaggerItem } from "../components/motion";
import { formatDate, formatINR, formatNumber, formatPct } from "../utils/format";

export default function ProductDetailPage() {
  const { id } = useParams();
  const productId = Number(id);
  const [horizon, setHorizon] = useState(30);
  const [poOpen, setPoOpen] = useState(false);

  const q = useQuery({
    queryKey: ["product", productId, horizon],
    queryFn: () => productsApi.detail(productId, horizon),
    enabled: Number.isFinite(productId) && productId > 0,
  });

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
        </div>
        <SkeletonCard lines={8} />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card>
        <ErrorState
          message={(q.error as Error)?.message || `Product ${id} could not be loaded.`}
          onRetry={() => q.refetch()}
        />
      </Card>
    );
  }

  const d = q.data;
  const m = d.metrics;

  return (
    <div>
      <Link to="/inventory" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink/50 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Inventory
      </Link>
      <PageHeader
        title={d.name}
        subtitle={`${d.sku} · ${d.category}${d.supplier ? ` · Supplier: ${d.supplier.name}` : ""}`}
        right={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPoOpen(true)}>
              <ClipboardList className="h-3.5 w-3.5" /> Create Purchase Order
            </Button>
            <StatusBadge status={m.status} />
          </>
        }
      />

      {/* Product info strip */}
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-ink/10 bg-surface px-5 py-3 text-xs text-ink/60">
        <span>Unit cost: <strong className="text-ink">{formatINR(m && d.unit_cost, false)}</strong></span>
        <span>Selling price: <strong className="text-ink">{formatINR(d.selling_price, false)}</strong></span>
        <span>Lead time: <strong className="text-ink">{d.lead_time_days} days</strong></span>
        <span>Status: <strong className="text-ink">{d.active ? "Active" : "Inactive"}</strong></span>
        {m.days_to_zero !== null && (
          <span>Days to zero: <strong className={m.days_to_zero < d.lead_time_days ? "text-red-600" : "text-ink"}>{m.days_to_zero.toFixed(1)}</strong></span>
        )}
      </div>

      {/* KPIs */}
      <Stagger className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6" stagger={0.05}>
        <StaggerItem><KpiCard label="Current Stock" value={formatNumber(m.current_stock)} unit="units" info="Most recent closing stock from the daily inventory ledger." /></StaggerItem>
        <StaggerItem><KpiCard label="Safety Stock" value={formatNumber(Math.round(m.safety_stock))} unit="units" info="Z × σ(demand) × √(lead time) — buffer for demand variability. Service level is configurable in Settings." /></StaggerItem>
        <StaggerItem><KpiCard label="Reorder Point" value={formatNumber(Math.round(m.reorder_point))} unit="units" info="Average daily demand × lead time + safety stock. Order when stock crosses this level." /></StaggerItem>
        <StaggerItem><KpiCard label="Avg Daily Demand" value={m.avg_daily_demand.toFixed(1)} unit="units/day" info="Mean units sold per day over the demand window (Settings)." /></StaggerItem>
        <StaggerItem><KpiCard label="Days Remaining" value={m.days_of_inventory !== null ? `${m.days_of_inventory.toFixed(0)}` : "—"} unit={m.days_of_inventory !== null ? "days" : "no demand"}
          info="Current stock ÷ average daily demand. Shows 'No recent demand' when the product has not sold recently." /></StaggerItem>
        <StaggerItem><KpiCard label="Inventory Value" value={formatINR(m.inventory_value)} info="Current stock × unit cost." /></StaggerItem>
      </Stagger>

      {/* Decision engine */}
      <div className="mt-4">
        <DecisionFlowCard d={d} onCreatePo={() => setPoOpen(true)} />
      </div>

      {/* Outbound health: variant × warehouse matrix, size risk, fulfillment, returns */}
      {d.outbound && d.outbound.total_units > 0 && (
        <Card className="mt-4">
          <CardHeader
            icon={<Shirt className="h-4 w-4" />}
            title="How healthy is this product across sizes and warehouses?"
            subtitle={`${formatNumber(d.outbound.total_units)} units across ${d.outbound.warehouses.length} DCs${d.outbound.sized ? " · sized product" : " · one-size product"}.`}
          />
          <CardBody className="overflow-x-auto">
            {d.outbound.size_risk && (
              <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-xs leading-relaxed text-red-700 dark:text-red-400">
                <strong>Size availability risk:</strong>{" "}
                {d.outbound.size_risk.at_risk.map((r) => `size ${r.size} (${r.units} units on hand, ${r.d30_demand} sold in 30d)`).join("; ")}.
                Estimated demand at risk over two weeks: ~₹{formatNumber(Math.round(d.outbound.size_risk.revenue_at_risk))}.
              </div>
            )}
            {d.outbound.sized ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Size</TH>
                    {d.outbound.warehouses.map((w) => <TH key={w} className="text-right">{w}</TH>)}
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <tbody>
                  {Object.entries(d.outbound.variants).map(([size, v]) => (
                    <TR key={size}>
                      <TD className="font-medium text-ink">{size}</TD>
                      {d.outbound!.warehouses.map((w) => {
                        const units = v.by_warehouse[w] ?? 0;
                        return (
                          <TD key={w} className="text-right">
                            <span className={`inline-block min-w-8 rounded-md px-1.5 py-0.5 text-xs font-medium ${
                              units === 0 ? "bg-red-500/10 text-red-600" : units < 10 ? "bg-amber-500/10 text-amber-700" : "text-ink/70"}`}>{units}</span>
                          </TD>
                        );
                      })}
                      <TD className="text-right font-semibold text-ink">{v.total}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            ) : (
              <div className="flex flex-wrap gap-2">
                {d.outbound.warehouses.map((w) => {
                  const units = Object.values(d.outbound!.variants).reduce((a, v) => a + (v.by_warehouse[w] ?? 0), 0);
                  return (
                    <span key={w} className="rounded-full border border-ink/10 bg-panel/70 px-3 py-1 text-xs text-ink/70">
                      {w}: <strong className="text-ink">{units}</strong> units
                    </span>
                  );
                })}
              </div>
            )}
            {d.outbound.fulfillment.orders_90d > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl bg-panel/70 px-4 py-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
                <span className="text-ink/50">Orders (90d): <strong className="text-ink">{formatNumber(d.outbound.fulfillment.orders_90d)}</strong></span>
                <span className="text-ink/50">Late: <strong className={d.outbound.fulfillment.late_rate_pct != null && d.outbound.fulfillment.late_rate_pct > 15 ? "text-red-600" : "text-ink"}>{d.outbound.fulfillment.late_rate_pct != null ? `${d.outbound.fulfillment.late_rate_pct}%` : "—"}</strong></span>
                <span className="text-ink/50">Cancelled: <strong className="text-ink">{d.outbound.fulfillment.cancel_rate_pct != null ? `${d.outbound.fulfillment.cancel_rate_pct}%` : "—"}</strong></span>
                <span className="text-ink/50">Returns (90d): <strong className={d.outbound.returns.return_rate_pct != null && d.outbound.returns.return_rate_pct > 25 ? "text-red-600" : "text-ink"}>{d.outbound.returns.returns_90d} ({d.outbound.returns.return_rate_pct != null ? `${d.outbound.returns.return_rate_pct}%` : "—"})</strong></span>
                <span className="text-ink/50">Top return reason: <strong className="text-ink">{d.outbound.returns.top_reasons[0]?.[0] ?? "—"}</strong></span>
                <span className="text-ink/50">Avg pick: <strong className="text-ink">{d.outbound.fulfillment.avg_pick_hours != null ? `${d.outbound.fulfillment.avg_pick_hours}h` : "—"}</strong></span>
                <span className="text-ink/50">Avg pack: <strong className="text-ink">{d.outbound.fulfillment.avg_pack_hours != null ? `${d.outbound.fulfillment.avg_pack_hours}h` : "—"}</strong></span>
                <span className="text-ink/50">Avg dispatch: <strong className="text-ink">{d.outbound.fulfillment.avg_dispatch_hours != null ? `${d.outbound.fulfillment.avg_dispatch_hours}h` : "—"}</strong></span>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Stock-out timeline markers */}
      {d.timeline && m.avg_daily_demand > 0 && (
        <Card className="mt-4">
          <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4 text-xs">
            <span className="font-semibold text-ink">Inventory timeline at current demand:</span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Reorder point: <strong>{d.timeline.reorder_point_day === 0 ? "already crossed" : d.timeline.reorder_point_day != null ? `day ${d.timeline.reorder_point_day}` : "—"}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-orange-500" /> Safety stock: <strong>{d.timeline.safety_stock_day === 0 ? "already crossed" : d.timeline.safety_stock_day != null ? `day ${d.timeline.safety_stock_day}` : "—"}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${d.timeline.stockout_day != null && d.timeline.stockout_day < d.timeline.lead_time_days ? "bg-red-500 animate-pulse" : "bg-red-500"}`} /> Stock-out: <strong>{d.timeline.stockout_day === 0 ? "stocked out today" : `day ${d.timeline.stockout_day ?? "—"}`}</strong>
            </span>
            <span className="text-ink/50">Replenishment arrives day {d.timeline.lead_time_days} (lead time)</span>
          </CardBody>
        </Card>
      )}

      {/* Charts */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="How has stock been moving?" subtitle="Closing stock, last 120 days" />
          <CardBody><StockTrendChart data={d.stock_history} height={250} /></CardBody>
        </Card>
        <Card>
          <CardHeader
            title="What will demand do next?"
            subtitle={`${d.forecast_method} · MAPE ${d.forecast_metrics.MAPE !== null ? formatPct(d.forecast_metrics.MAPE) : "n/a"}`}
          />
          <CardBody><DemandForecastChart data={d.forecast_chart as never} height={250} /></CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader
            title="Will current inventory cover future demand?"
            subtitle={`Projection over the next ${horizon} days versus reorder point and safety stock`}
            right={
              <div className="flex gap-1">
                {[14, 30, 60].map((h) => (
                  <button key={h} onClick={() => setHorizon(h)}
                    className={`rounded-md px-2 py-1 text-xs font-medium ${horizon === h ? "bg-brand-50 text-brand-700" : "text-ink/50 hover:bg-ink/10"}`}>
                    {h}d
                  </button>
                ))}
              </div>
            }
          />
          <CardBody>
            <ProjectionChart data={d.projection} height={300} />
            <div className="mt-2 rounded-lg bg-ink/5 p-3 text-xs leading-relaxed text-ink/70">
              <p><strong>Reading this chart:</strong> the shaded area is projected stock at current demand. Where it crosses the
                <span className="mx-1" style={{ color: CHART_COLORS.amber }}>amber line (reorder point)</span>,
                a purchase order should already be in flight; the
                <span className="mx-1" style={{ color: CHART_COLORS.red }}>red dashed line (safety stock)</span>
                is the buffer that must survive until replenishment arrives ({d.lead_time_days}-day lead time).
              </p>
              <p className="mt-1.5 text-ink/50">
                Formulas — {Object.entries(d.formulas).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Purchase history */}
      <Card className="mt-4">
        <CardHeader title="Purchase history" subtitle="Latest purchase orders for this product" />
        {d.purchase_orders.length === 0 ? (
          <EmptyState title="No purchase orders yet" message="Create one to start the replenishment trail." />
        ) : (
          <Table>
            <THead>
              <TR><TH>PO Number</TH><TH>Supplier</TH><TH className="text-right">Quantity</TH><TH className="text-right">Total Cost</TH><TH>Ordered</TH><TH>Expected</TH><TH>Received</TH><TH>Status</TH></TR>
            </THead>
            <tbody>
              {d.purchase_orders.map((po) => (
                <TR key={po.id}>
                  <TD className="font-medium text-ink">{po.po_number}</TD>
                  <TD className="text-ink/50">{po.supplier}</TD>
                  <TD className="text-right">{formatNumber(po.quantity)}</TD>
                  <TD className="text-right text-ink/50">{formatINR(po.total_cost)}</TD>
                  <TD className="text-ink/50">{formatDate(po.order_date)}</TD>
                  <TD className="text-ink/50">{formatDate(po.expected_date)}</TD>
                  <TD className="text-ink/50">{formatDate(po.actual_date)}</TD>
                  <TD>
                    <Badge tone={po.status === "Delivered" ? "green" : po.status === "Delayed" ? "red" : po.status === "Cancelled" ? "gray" : "blue"} dot>
                      {po.status}{po.days_late ? ` (+${po.days_late}d)` : ""}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <CreatePODialog open={poOpen} onClose={() => setPoOpen(false)} productId={productId} />
    </div>
  );
}
