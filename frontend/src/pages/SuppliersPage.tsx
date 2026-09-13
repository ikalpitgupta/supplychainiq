import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Download, Eye } from "lucide-react";
import { suppliersApi } from "../api/endpoints";
import { downloadCsv } from "../api/client";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, InfoTip, Select, SkeletonRows, Table, TD, TH, THead, TR } from "../components/ui";
import { PageHeader } from "../components/shared";
import { formatINR, formatNumber, formatPct } from "../utils/format";
import { useToast } from "../hooks/useToast";
import type { SupplierScore } from "../types";

export default function SuppliersPage() {
  const [search, setSearch] = useState("");
  const [risk, setRisk] = useState("");
  const [sort, setSort] = useState("score");
  const [detail, setDetail] = useState<SupplierScore | null>(null);
  const { push } = useToast();

  const q = useQuery({
    queryKey: ["suppliers", { search, risk, sort }],
    queryFn: () => suppliersApi.list({ search: search || undefined, risk: risk || undefined, sort }),
  });

  const rows = q.data?.items ?? [];
  const weights = q.data?.weights;

  return (
    <div className="cascade">
      <PageHeader
        title="Suppliers"
        subtitle="Scored supplier base — delivery, quality, cost, and reliability in one view."
        right={
          <Button variant="secondary" size="sm" onClick={async () => {
            try { await downloadCsv("suppliers"); push("success", "Suppliers CSV exported"); }
            catch (e) { push("error", e instanceof Error ? e.message : "Export failed"); }
          }}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink/10 p-4">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier…" className="max-w-xs" aria-label="Search suppliers" />
          <Select value={risk} onChange={(e) => setRisk(e.target.value)} className="w-40" aria-label="Risk filter">
            <option value="">All risk levels</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-44" aria-label="Sort suppliers">
            <option value="score">Sort: Score</option>
            <option value="name">Sort: Name</option>
            <option value="ontime">Sort: On-time %</option>
            <option value="lead">Sort: Lead time</option>
            <option value="cost">Sort: Unit cost</option>
            <option value="orders">Sort: Orders</option>
          </Select>
          {weights && (
            <span className="ml-auto text-xs text-ink/35">
              Score weights: 30% delivery · 25% quality · 25% cost · 20% reliability
              <InfoTip text="Each metric is min-max normalized across suppliers, then combined with these fixed weights. The score is fully transparent — click 'Why this score?' on any row." />
            </span>
          )}
        </div>

        {q.isError && <ErrorState message={(q.error as Error)?.message || "Failed to load suppliers"} onRetry={() => q.refetch()} />}
        {q.isLoading && <SkeletonRows rows={8} />}

        {q.data && (
          q.data.items.length === 0 ? (
            <EmptyState title="No suppliers match" message="Adjust the search or risk filter." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Supplier</TH>
                  <TH className="text-right">Products <InfoTip text="Number of products currently sourced from this supplier." /></TH>
                  <TH className="text-right">Avg Lead Time</TH>
                  <TH className="text-right">On-Time % <InfoTip text="Baseline on-time delivery rate; observed recent rate shown in the detail page." /></TH>
                  <TH className="text-right">Defect Rate</TH>
                  <TH className="text-right">Cost Index <InfoTip text="1.00 = market average unit cost. Below 1.00 is cheaper than market." /></TH>
                  <TH className="text-right">Total Orders</TH>
                  <TH className="text-right">Score <InfoTip text="Weighted, normalized 0–100 supplier score. Weights: 30% delivery, 25% quality, 25% cost, 20% reliability." /></TH>
                  <TH>Risk</TH>
                  <TH></TH>
                </TR>
              </THead>
              <tbody>
                {rows.map((s) => (
                  <TR key={s.id ?? s.supplier_id}>
                    <TD>
                      <Link to={`/suppliers/${s.id ?? s.supplier_id}`} className="font-medium text-brand-700 hover:underline">{s.name}</Link>
                    </TD>
                    <TD className="text-right text-ink/50">{s.product_count ?? "—"}</TD>
                    <TD className="text-right text-ink/50">{s.lead_time_days ?? "—"}d</TD>
                    <TD className="text-right text-ink/50">{formatPct(s.on_time_rate * 100, 0)}</TD>
                    <TD className="text-right text-ink/50">{formatPct(s.defect_rate * 100, 1)}</TD>
                    <TD className="text-right text-ink/50">{s.unit_cost.toFixed(2)}</TD>
                    <TD className="text-right text-ink/50">{formatNumber(s.orders)}</TD>
                    <TD className="text-right">
                      <span className={`font-semibold ${(s.total) >= 65 ? "text-emerald-700" : s.total >= 45 ? "text-amber-700" : "text-red-600"}`}>
                        {s.total.toFixed(0)}
                      </span>
                      <span className="text-xs text-ink/35">/100</span>
                    </TD>
                    <TD>
                      <Badge tone={s.risk_level === "Low" ? "green" : s.risk_level === "Medium" ? "yellow" : "red"} dot>
                        {s.risk_level}
                      </Badge>
                    </TD>
                    <TD>
                      <Button variant="ghost" size="sm" onClick={() => setDetail(s)} aria-label={`Why this score for ${s.name}`}>
                        <Eye className="h-3.5 w-3.5" /> Why?
                      </Button>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )
        )}
      </Card>

      {/* Score breakdown dialog */}
      <Dialog open={!!detail} onClose={() => setDetail(null)} title={`Why this score? — ${detail?.name ?? ""}`}>
        {detail && (
          <div>
            <div className="flex items-baseline justify-between rounded-xl bg-ink/5 p-4">
              <div>
                <p className="text-xs text-ink/50">Final score</p>
                <p className="text-3xl font-semibold text-ink">{detail.total.toFixed(0)}<span className="text-base text-ink/35">/100</span></p>
              </div>
              <Badge tone={detail.risk_level === "Low" ? "green" : detail.risk_level === "Medium" ? "yellow" : "red"} dot>{detail.risk_level} risk</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { label: "Delivery (on-time rate)", weight: 30, pts: detail.delivery_pts },
                { label: "Quality (1 − defect rate)", weight: 25, pts: detail.quality_pts },
                { label: "Cost (lower is better)", weight: 25, pts: detail.cost_pts },
                { label: "Reliability", weight: 20, pts: detail.reliability_pts },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink">{row.label} <span className="text-ink/35">· {row.weight}% weight</span></span>
                    <span className="font-semibold text-ink">{row.pts.toFixed(0)}/100</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-ink/10">
                    <div className={`h-2 rounded-full ${row.pts >= 65 ? "bg-emerald-500" : row.pts >= 45 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${row.pts}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink/50">
              Each component is min-max normalized across all suppliers, then combined: 30% delivery + 25% quality +
              25% cost + 20% reliability. Total spend with this supplier: {formatINR(detail.total_spend ?? 0)} across {formatNumber(detail.orders)} orders.
            </p>
            <div className="mt-4 flex justify-end">
              <Link to={`/suppliers/${detail.id ?? detail.supplier_id}`}>
                <Button size="sm">Open full profile</Button>
              </Link>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
