// Returns page — measured from the outbound order book (ReturnLine records
// joined to delivered customer orders). Rates, reasons, dispositions, and the
// ops→CX link are all computed; nothing is benchmarked or hand-waved.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeftRight, PackageCheck, RotateCcw, Shirt } from "lucide-react";
import { outboundApi } from "../api/endpoints";
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton, Table, TD, TH, THead, TR } from "../components/ui";
import { PageHeader } from "../components/shared";
import { formatNumber } from "../utils/format";

export default function ReturnsPage() {
  const intel = useQuery({ queryKey: ["returns-intel"], queryFn: () => outboundApi.returnsIntel(90) });
  const impact = useQuery({ queryKey: ["outbound-customer-impact"], queryFn: () => outboundApi.customerImpact(30) });
  const d = intel.data;
  const ci = impact.data;

  const totalDispositions = d ? Object.values(d.by_disposition).reduce((a, b) => a + b, 0) : 0;
  const topDisposition = d
    ? Object.entries(d.by_disposition).sort((a, b) => b[1] - a[1])[0]
    : undefined;

  return (
    <div className="cascade space-y-6">
      <PageHeader
        title="Returns"
        subtitle="Measured from the customer order book — return rates, reasons, dispositions, and what they cost, over the last 90 days."
      />

      {intel.isError && (
        <Card>
          <ErrorState message={(intel.error as Error)?.message || "Failed to load returns data"} onRetry={() => intel.refetch()} />
        </Card>
      )}

      {!intel.data && intel.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Card key={i} className="p-5"><Skeleton className="h-16" /></Card>)}
        </div>
      )}

      {d && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <p className="text-xs text-ink/50">Returns (90d)</p>
            <p className="font-display text-3xl font-semibold text-ink">{formatNumber(d.returns)}</p>
            <p className="text-[11px] text-ink/40">from {formatNumber(d.delivered_orders)} delivered orders</p>
          </Card>
          <Card className="p-5">
            <p className="text-xs text-ink/50">Return rate</p>
            <p className="font-display text-3xl font-semibold text-ink">{d.return_rate_pct ?? "—"}<span className="text-lg text-ink/40">%</span></p>
            <p className="text-[11px] text-ink/40">returns ÷ delivered orders, same window</p>
          </Card>
          <Card className="p-5">
            <p className="text-xs text-ink/50">Dominant return reason</p>
            <p className="font-display text-xl font-semibold text-ink">{d.by_reason[0]?.reason ?? "—"}</p>
            <p className="text-[11px] text-ink/40">
              {d.by_reason[0] ? `${d.by_reason[0].count} of ${d.returns} returns` : "no returns recorded"}
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-xs text-ink/50">Where returns go</p>
            <p className="font-display text-xl font-semibold text-ink">{topDisposition?.[0] ?? "—"}</p>
            <p className="text-[11px] text-ink/40">
              {topDisposition && totalDispositions
                ? `${Math.round(topDisposition[1] / totalDispositions * 100)}% of ${formatNumber(totalDispositions)} processed`
                : "no dispositions recorded"}
            </p>
          </Card>
        </div>
      )}

      {ci && ci.findings.length > 0 && (
        <Card>
          <CardHeader
            icon={<ArrowLeftRight size={15} aria-hidden />}
            title="How operations show up in customer experience"
            subtitle="Movements stated only when both halves of the 30-day window are measurable."
          />
          <CardBody>
            <ul className="space-y-2">
              {ci.findings.map((f, i) => (
                <li key={i} className="rounded-xl bg-panel/70 px-3 py-2 text-xs leading-relaxed text-ink/80">{f}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {d && d.by_reason.length > 0 && (
        <Card>
          <CardHeader
            icon={<RotateCcw size={15} aria-hidden />}
            title="Why do customers return products?"
            subtitle="Counted from return lines over the last 90 days."
          />
          <CardBody className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Reason</TH>
                  <TH className="text-right">Returns</TH>
                  <TH className="text-right">Share of returns</TH>
                </TR>
              </THead>
              <tbody>
                {d.by_reason.map((r) => (
                  <TR key={r.reason}>
                    <TD className="font-medium text-ink">{r.reason}</TD>
                    <TD className="text-right text-ink/70">{r.count.toLocaleString()}</TD>
                    <TD className="text-right text-ink/70">{Math.round(r.count / d.returns * 100)}%</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {d && d.top_products.length > 0 && (
        <Card>
          <CardHeader
            icon={<Shirt size={15} aria-hidden />}
            title="Which products are driving avoidable returns?"
            subtitle="Most-returned products with their measured rate against delivered orders in the window."
          />
          <CardBody className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="text-right">Returns (90d)</TH>
                  <TH className="text-right">Return rate</TH>
                </TR>
              </THead>
              <tbody>
                {d.top_products.map((p) => (
                  <TR key={p.product_id}>
                    <TD>
                      <Link to={`/products/${p.product_id}`} className="font-medium text-brand-700 hover:underline">{p.product}</Link>
                    </TD>
                    <TD className="text-right text-ink/70">{p.returns.toLocaleString()}</TD>
                    <TD className="text-right">
                      {p.return_rate_pct != null ? (
                        <Badge tone={p.return_rate_pct >= (d.return_rate_pct ?? 0) * 1.5 ? "red" : p.return_rate_pct >= (d.return_rate_pct ?? 0) ? "yellow" : "gray"} dot>
                          {p.return_rate_pct}%
                        </Badge>
                      ) : "—"}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {d && d.by_category.length > 0 && (
        <Card>
          <CardHeader
            icon={<PackageCheck size={15} aria-hidden />}
            title="Do sized categories return more?"
            subtitle="Measured return rate by category — sized categories (apparel, footwear) typically out-return one-size goods."
          />
          <CardBody className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Category</TH>
                  <TH className="text-right">Returns</TH>
                  <TH className="text-right">Return rate</TH>
                </TR>
              </THead>
              <tbody>
                {d.by_category.map((c) => (
                  <TR key={c.category}>
                    <TD className="font-medium text-ink">{c.category}</TD>
                    <TD className="text-right text-ink/70">{c.returns.toLocaleString()}</TD>
                    <TD className="text-right text-ink/70">{c.return_rate_pct != null ? `${c.return_rate_pct}%` : "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
