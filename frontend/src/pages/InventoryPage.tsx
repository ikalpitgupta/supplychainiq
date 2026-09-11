import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Download, Search } from "lucide-react";
import { productsApi } from "../api/endpoints";
import { downloadCsv } from "../api/client";
import { Button, Card, EmptyState, ErrorState, InfoTip, Input, Pagination, Select, SkeletonRows, Table, TD, TH, THead, TR } from "../components/ui";
import { PageHeader, StatusBadge } from "../components/shared";
import { formatDays, formatINR, formatNumber } from "../utils/format";
import { useToast } from "../hooks/useToast";
import type { InventoryStatus } from "../types";

const STATUSES: InventoryStatus[] = ["Healthy", "Low Stock", "Critical", "Overstock"];

export default function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const { push } = useToast();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const page = Number(params.get("page") ?? 1);
  const category = params.get("category") ?? "";
  const status = params.get("status") ?? "";
  const supplier = params.get("supplier") ?? "";
  const sort = params.get("sort") ?? "name";
  const direction = params.get("direction") ?? "asc";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ["inventory", { search, category, status, supplier, sort, direction, page }],
    queryFn: () => productsApi.list({ search, category, status, supplier_id: supplier ? Number(supplier) : undefined, sort, direction, page, page_size: 15 }),
  });

  const rows = query.data?.items ?? [];
  const categories = query.data?.categories ?? [];
  const suppliers = query.data?.suppliers ?? [];

  const sortIndicator = useMemo(() => ({ name: "Product", stock: "Current Stock", demand: "Daily Demand", doi: "Days of Inventory", rop: "Reorder Point", value: "Inventory Value" }), []);

  const exportCsv = async () => {
    try {
      await downloadCsv("inventory");
      push("success", "Inventory CSV exported");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Current stock position with reorder math for every product."
        right={
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        }
      />

      <Card>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink/10 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/35" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter") setParam("search", search); }}
              onBlur={() => setParam("search", search)}
              placeholder="Search product or SKU — press Enter"
              className="pl-9"
              aria-label="Search products"
            />
          </div>
          <Select value={category} onChange={(e) => setParam("category", e.target.value)} className="w-44" aria-label="Category filter">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setParam("status", e.target.value)} className="w-40" aria-label="Status filter">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={supplier} onChange={(e) => setParam("supplier", e.target.value)} className="w-48" aria-label="Supplier filter">
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={`${sort}:${direction}`} onChange={(e) => { const [s, d] = e.target.value.split(":"); setParam("sort", s); setParam("direction", d); }} className="w-48" aria-label="Sort">
            {Object.entries(sortIndicator).map(([k, label]) => (
              <optgroup key={k} label={label}>
                <option value={`${k}:asc`}>{label} ↑</option>
                <option value={`${k}:desc`}>{label} ↓</option>
              </optgroup>
            ))}
          </Select>
        </div>

        {query.isError && <ErrorState message={(query.error as Error)?.message || "Failed to load inventory"} onRetry={() => query.refetch()} />}

        {query.isLoading && <SkeletonRows rows={8} />}

        {query.data && (
          query.data.total === 0 ? (
            <EmptyState
              title="No products match these filters"
              message="Try clearing the search or choosing a different status."
              action={<Button variant="secondary" size="sm" onClick={() => setParams({}, { replace: true })}>Clear filters</Button>}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH>Category</TH>
                    <TH className="text-right">Current Stock</TH>
                    <TH className="text-right">Daily Demand <InfoTip text="Average units sold per day over the configured demand window (Settings)." /></TH>
                    <TH className="text-right">Days of Inventory <InfoTip text="Current stock ÷ average daily demand. 'No recent demand' is shown when a product has not sold in the window." /></TH>
                    <TH className="text-right">Reorder Point <InfoTip text="Average daily demand × lead time + safety stock. Order when stock crosses this level." /></TH>
                    <TH className="text-right">Safety Stock <InfoTip text="Z × σ(demand) × √(lead time). Protects against demand variability during replenishment." /></TH>
                    <TH className="text-right">Inventory Value</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <tbody>
                  {rows.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <Link to={`/products/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link>
                        <span className="block text-xs text-ink/35">{p.sku}</span>
                      </TD>
                      <TD className="text-ink/50">{p.category}</TD>
                      <TD className="text-right font-medium">{formatNumber(p.current_stock)}</TD>
                      <TD className="text-right text-ink/50">{p.avg_daily_demand.toFixed(1)}</TD>
                      <TD className="text-right text-ink/50">{formatDays(p.days_of_inventory)}</TD>
                      <TD className="text-right text-ink/50">{formatNumber(Math.round(p.reorder_point))}</TD>
                      <TD className="text-right text-ink/50">{formatNumber(Math.round(p.safety_stock))}</TD>
                      <TD className="text-right text-ink/50">{formatINR(p.inventory_value)}</TD>
                      <TD><StatusBadge status={p.status} /></TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={15} total={query.data.total} onPage={(p) => setParam("page", String(p))} />
            </>
          )
        )}
      </Card>
    </div>
  );
}
