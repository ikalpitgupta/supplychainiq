// Returns page — honest placeholder built on real data (no fake CRUD).
// The demo dataset has no returns ledger yet, so this page states exactly
// what is missing, exposes which high-volume fashion lines carry return-risk
// profiles, and links into the pages that already track the upstream drivers.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeftRight, Info, Shirt } from "lucide-react";
import { returnsApi } from "../api/endpoints";
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton, Table, TD, TH, THead, TR } from "../components/ui";
import { PageHeader } from "../components/shared";

export default function ReturnsPage() {
  const q = useQuery({ queryKey: ["returns"], queryFn: returnsApi.summary });
  const d = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Returns"
        subtitle="Return-rate exposure by product line — the stage of the journey this demo dataset does not yet record."
      />

      {q.isError && (
        <Card><ErrorState message={(q.error as Error)?.message || "Failed to load returns data"} onRetry={() => q.refetch()} /></Card>
      )}

      {q.isLoading || !d ? (
        <div className="space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <>
          <Card>
            <CardBody className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-500">
                <Info size={18} aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{d.message}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink/60">{d.reason}</p>
                <p className="mt-1 text-[11px] text-ink/40">Scope of this build: {d.scope}</p>
              </div>
            </CardBody>
          </Card>

          {d.top_lines.length > 0 && d.indicative_rate_pct != null && (
            <Card>
              <CardHeader
                icon={<ArrowLeftRight size={15} aria-hidden />}
                title="Where returns would bite first"
                subtitle={`Indicative return-exposure bands, not measured rates. Category benchmark: ${d.indicative_rate_pct.toFixed(0)}% of units (industry experience for fashion e-commerce).`}
              />
              <CardBody className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Product</TH><TH>Category</TH>
                      <TH className="text-right">Units sold (365d)</TH><TH className="text-right">Revenue (365d)</TH>
                      <TH>Return band</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {d.top_lines.map((l) => (
                      <TR key={l.product_id}>
                        <TD>
                          <Link to={`/products/${l.product_id}`} className="font-medium text-brand-700 hover:underline">{l.product}</Link>
                          <p className="text-[11px] text-ink/40">{l.exposure_note}</p>
                        </TD>
                        <TD className="text-ink/50">{l.category}</TD>
                        <TD className="text-right text-ink/70">{l.sold_365d.toLocaleString()}</TD>
                        <TD className="text-right text-ink/70">₹{Math.round(l.revenue_365d).toLocaleString("en-IN")}</TD>
                        <TD>
                          <Badge tone={l.return_band.includes("High") ? "red" : l.return_band.includes("Elevated") ? "yellow" : "gray"} dot>
                            {l.return_band}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
                <p className="mt-3 text-[11px] leading-relaxed text-ink/40">
                  Bands are analytical exposure flags derived from category benchmarks and product attributes — not measured return
                  rates. They exist to show which lines a returns ledger would need to watch first.
                </p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader icon={<Shirt size={15} aria-hidden />} title="Upstream drivers already tracked" subtitle="Return rates in fashion e-commerce are driven by fit, quality, and expectation gaps — the signals below already exist in this platform." />
            <CardBody className="grid gap-3 md:grid-cols-3">
              <Link to="/inventory?status=Overstock" className="rounded-2xl border border-ink/10 p-3.5 transition-colors hover:bg-ink/[0.04]">
                <p className="text-sm font-semibold text-ink">Overstock lines</p>
                <p className="mt-1 text-xs text-ink/50">Slow fashion lines often correlate with high return volumes — see what is already overstocked.</p>
              </Link>
              <Link to="/delivery" className="rounded-2xl border border-ink/10 p-3.5 transition-colors hover:bg-ink/[0.04]">
                <p className="text-sm font-semibold text-ink">Late deliveries</p>
                <p className="mt-1 text-xs text-ink/50">Customer cancellations and returns spike when inbound replenishment slips.</p>
              </Link>
              <Link to="/intelligence" className="rounded-2xl border border-ink/10 p-3.5 transition-colors hover:bg-ink/[0.04]">
                <p className="text-sm font-semibold text-ink">Price & quality signals</p>
                <p className="mt-1 text-xs text-ink/50">Purchase-price drift and supplier defect rates feed the quality half of the returns story.</p>
              </Link>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
