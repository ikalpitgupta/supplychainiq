// Inbound Intelligence — procurement, catalog quality, pricing, promotions.
//
// One page, four lenses. Every section is a business question answered from
// live data; the copy distinguishes measured facts from estimates and never
// claims causation the data can't support.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "../components/motion";
import {
  ArrowRight, BadgePercent, BookOpenCheck, Boxes, Handshake, Tags, TrendingDown, TrendingUp,
} from "lucide-react";
import { inboundApi } from "../api/endpoints";
import {
  Badge, Card, CardBody, CardHeader, ErrorState, SkeletonCard, Table, TD, TH, THead, TR,
} from "../components/ui";
import { KpiCard, PageHeader } from "../components/shared";
import { Stagger, StaggerItem } from "../components/motion";
import { formatINR, formatNumber, formatPct } from "../utils/format";
import type {
  CampaignStats, CatalogCategoryQuality, CatalogQuality, InboundSupplierRisk, PriceMove,
  PricingIntel, PricingRow, ProcurementLinkage, PromotionsIntel,
} from "../types";

export default function InboundPage() {
  const procurement = useQuery({ queryKey: ["inbound-procurement"], queryFn: () => inboundApi.procurement(120), staleTime: 120_000 });
  const catalog = useQuery({ queryKey: ["inbound-catalog"], queryFn: inboundApi.catalogQuality, staleTime: 300_000 });
  const pricing = useQuery({ queryKey: ["inbound-pricing"], queryFn: () => inboundApi.pricing(90), staleTime: 120_000 });
  const promos = useQuery({ queryKey: ["inbound-promotions"], queryFn: () => inboundApi.promotions(90), staleTime: 120_000 });

  const loading = procurement.isLoading || catalog.isLoading || pricing.isLoading || promos.isLoading;
  const error = procurement.error || catalog.error || pricing.error || promos.error;

  return (
    <div className="cascade space-y-8">
      <PageHeader
        title="Inbound Intelligence"
        subtitle="Procurement, catalog quality, pricing, and promotions — where supplier and catalog decisions become inventory and margin outcomes."
      />

      {(error as Error) && !loading && (
        <Card><ErrorState message={(error as Error).message || "Failed to load inbound intelligence"} onRetry={() => { procurement.refetch(); catalog.refetch(); pricing.refetch(); promos.refetch(); }} /></Card>
      )}

      {loading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} lines={2} />)}
        </div>
      )}

      {!loading && !error && (
        <Stagger className="space-y-8" stagger={0.05}>
          <HeadlineStrip procurement={procurement.data} catalog={catalog.data} pricing={pricing.data} promos={promos.data} />

          {/* ── 1 · Procurement ─────────────────────────────────────────── */}
          <Section icon={<Handshake className="h-4 w-4" />} n="01" title="Which supplier decisions create downstream inventory risk?"
            lead="Inbound reliability joined to the stock-out and overstock exposure of the products each supplier feeds.">
            {procurement.data && (
              <div className="grid gap-4 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                  <CardHeader
                    title="Supplier risk linkage"
                    subtitle="On-time and defect are measured from POs in the window; the last two columns are downstream inventory consequences."
                  />
                  <CardBody className="overflow-x-auto">
                    <Table>
                      <THead>
                        <TR>
                          <TH>Supplier</TH>
                          <TH className="text-right">On-time (PO)</TH>
                          <TH className="text-right">Avg late</TH>
                          <TH className="text-right">Defect</TH>
                          <TH className="text-right">Lead</TH>
                          <TH className="text-right">Stock-out SKUs</TH>
                          <TH className="text-right">Overstock SKUs</TH>
                        </TR>
                      </THead>
                      <tbody>
                        {procurement.data.suppliers.slice(0, 8).map((s: InboundSupplierRisk) => {
                          const flagged = procurement.data!.flagged.includes(s.supplier);
                          return (
                            <TR key={s.supplier_id} className={flagged ? "bg-red-500/5" : undefined}>
                              <TD>
                                <Link to={`/suppliers/${s.supplier_id}`} className="font-medium text-brand-700 hover:underline">{s.supplier}</Link>
                                {flagged && <Badge tone="red" dot>risk linkage</Badge>}
                              </TD>
                              <TD className="text-right">{s.po_on_time_rate != null ? formatPct(s.po_on_time_rate * 100) : "—"}</TD>
                              <TD className="text-right text-ink/60">{s.avg_days_late ? `+${s.avg_days_late}d` : "—"}</TD>
                              <TD className="text-right text-ink/60">{formatPct(s.defect_rate * 100)}</TD>
                              <TD className="text-right text-ink/60">{s.lead_time_days}d</TD>
                              <TD className="text-right">
                                <span className={s.stockout_products > 0 ? "font-semibold text-red-600" : "text-ink/50"}>{s.stockout_products}</span>
                              </TD>
                              <TD className="text-right text-ink/50">{s.overstock_products}</TD>
                            </TR>
                          );
                        })}
                      </tbody>
                    </Table>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="How concentrated is our buying?" subtitle="Spend share by supplier over the window." icon={<Boxes className="h-4 w-4" />} />
                  <CardBody className="space-y-3">
                    <div className="flex items-baseline gap-4">
                      <div>
                        <p className="text-xs text-ink/50">Top 3 suppliers</p>
                        <p className="font-display text-2xl font-semibold text-ink">{formatPct(procurement.data.concentration.top3_share * 100)}</p>
                        <p className="text-[11px] text-ink/40">of PO spend</p>
                      </div>
                      <div>
                        <p className="text-xs text-ink/50">HHI</p>
                        <p className="font-display text-2xl font-semibold text-ink">{(procurement.data.concentration.hhi * 100).toFixed(0)}</p>
                        <p className="text-[11px] text-ink/40">below 1500 = unconcentrated</p>
                      </div>
                    </div>
                    {procurement.data.concentration.top.map((t: { supplier: string; spend: number; spend_share: number }) => (
                      <div key={t.supplier}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-ink/70">{t.supplier}</span>
                          <span className="text-ink/50">{formatPct(t.spend_share * 100)} · {formatINR(t.spend)}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-ink/10">
                          <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(100, t.spend_share * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                    {procurement.data.flagged.length > 0 && (
                      <p className="rounded-xl bg-panel/70 px-3 py-2 text-xs leading-relaxed text-ink/70">
                        <strong className="text-ink">Risk linkage:</strong> {procurement.data.flagged.slice(0, 3).join(", ")} —
                        late or defect-prone inbound that coincides with stock-out exposure on their SKUs. A conversation
                        (or a second source) before the next order.
                      </p>
                    )}
                  </CardBody>
                </Card>
              </div>
            )}
          </Section>

          {/* ── 2 · Catalog quality ─────────────────────────────────────── */}
          <Section icon={<BookOpenCheck className="h-4 w-4" />} n="02" title="Where is the catalog incomplete — and what does it cost?"
            lead="Missing attributes degrade search, filtering, and conversions; missing size charts feed the returns problem.">
            {catalog.data && (
              <div className="grid gap-4 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                  <CardHeader title="Attribute completeness by category" subtitle={`${formatPct(catalog.data.complete_pct)} complete across ${catalog.data.total_products} products.`} />
                  <CardBody className="overflow-x-auto">
                    <Table>
                      <THead>
                        <TR>
                          <TH>Category</TH>
                          <TH className="text-right">Complete</TH>
                          <TH className="text-right">No color</TH>
                          <TH className="text-right">No material</TH>
                          <TH className="text-right">No description</TH>
                          <TH className="text-right">No image</TH>
                          <TH className="text-right">No size chart</TH>
                        </TR>
                      </THead>
                      <tbody>
                        {catalog.data.by_category.map((c: CatalogCategoryQuality) => (
                          <TR key={c.category}>
                            <TD className="font-medium text-ink">{c.category}</TD>
                            <TD className="text-right">
                              <Badge tone={c.complete_pct >= 90 ? "green" : c.complete_pct >= 80 ? "yellow" : "red"} dot>{c.complete_pct}%</Badge>
                            </TD>
                            <TD className="text-right text-ink/50">{c.missing.color || "—"}</TD>
                            <TD className="text-right text-ink/50">{c.missing.material || "—"}</TD>
                            <TD className="text-right text-ink/50">{c.missing.description || "—"}</TD>
                            <TD className="text-right text-ink/50">{c.missing.image || "—"}</TD>
                            <TD className="text-right">
                              {c.size_chart_missing_pct != null
                                ? <span className={c.size_chart_missing_pct > 15 ? "font-semibold text-red-600" : "text-ink/50"}>{c.size_chart_missing_pct}%</span>
                                : "—"}
                            </TD>
                          </TR>
                        ))}
                      </tbody>
                    </Table>
                    {catalog.data.size_chart_linkage && (
                      <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                        {catalog.data.size_chart_linkage}
                      </p>
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Fix these first" subtitle="Products with the most gaps — each one is a search/filter dead end." />
                  <CardBody className="space-y-2">
                    <p className="rounded-xl bg-panel/70 px-3 py-2 text-xs leading-relaxed text-ink/80">{catalog.data.headline}.</p>
                    {catalog.data.affected_products.slice(0, 6).map((p) => (
                      <div key={p.sku} className="rounded-xl bg-panel/70 px-3 py-2">
                        <p className="text-xs font-semibold text-ink">{p.name}</p>
                        <p className="text-[11px] text-ink/50">{p.category} · missing: {p.gaps.join(", ")}</p>
                      </div>
                    ))}
                  </CardBody>
                </Card>
              </div>
            )}
          </Section>

          {/* ── 3 · Pricing ─────────────────────────────────────────────── */}
          <Section icon={<Tags className="h-4 w-4" />} n="03" title="Where is discounting eating margin — and what did price changes do?"
            lead="Margin, list-price discounting, and observed unit movement after price changes.">
            {pricing.data && (
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader
                    title="High discount, low margin"
                    subtitle={`Avg portfolio margin ${formatPct((pricing.data.avg_margin_pct ?? 0) * 100)} — these products sit far below it while carrying deep list discounts.`}
                    icon={<BadgePercent className="h-4 w-4" />}
                  />
                  <CardBody className="overflow-x-auto">
                    {pricing.data.high_discount_low_margin.length === 0 ? (
                      <p className="rounded-xl bg-panel/70 px-3 py-3 text-xs text-ink/60">No products currently pair ≥20% list discounts with ≤35% margins.</p>
                    ) : (
                      <Table>
                        <THead>
                          <TR>
                            <TH>Product</TH>
                            <TH className="text-right">Price vs MRP</TH>
                            <TH className="text-right">Discount</TH>
                            <TH className="text-right">Margin</TH>
                            <TH className="text-right">Revenue (90d)</TH>
                          </TR>
                        </THead>
                        <tbody>
                          {pricing.data.high_discount_low_margin.map((p: PricingRow) => (
                            <TR key={p.product_id}>
                              <TD><Link to={`/products/${p.product_id}`} className="font-medium text-brand-700 hover:underline">{p.product}</Link></TD>
                              <TD className="text-right text-ink/60">{formatINR(p.price)} <span className="text-ink/40 line-through">{formatINR(p.mrp)}</span></TD>
                              <TD className="text-right"><Badge tone="red" dot>{formatPct(p.discount_pct * 100)}</Badge></TD>
                              <TD className="text-right"><Badge tone={p.margin_pct < 0.25 ? "red" : "yellow"}>{formatPct(p.margin_pct * 100)}</Badge></TD>
                              <TD className="text-right text-ink/60">{formatINR(p.revenue)}</TD>
                            </TR>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader
                    title="What happened after price changes?"
                    subtitle="Units in the current window vs the prior one, for products whose price moved."
                    icon={<TrendingUp className="h-4 w-4" />}
                  />
                  <CardBody className="overflow-x-auto">
                    <Table>
                      <THead>
                        <TR>
                          <TH>Product</TH>
                          <TH className="text-right">Price</TH>
                          <TH className="text-right">Units Δ</TH>
                        </TR>
                      </THead>
                      <tbody>
                        {pricing.data.price_moves.slice(0, 6).map((m: PriceMove) => (
                          <TR key={m.product_id} className={m.direction === "up" && (m.units_change_pct ?? 0) < -0.1 ? "bg-red-500/5" : undefined}>
                            <TD>
                              <Link to={`/products/${m.product_id}`} className="font-medium text-brand-700 hover:underline">{m.product}</Link>
                              {m.direction === "up" && (m.units_change_pct ?? 0) < -0.1 && <Badge tone="red" dot><TrendingDown className="h-3 w-3" /> declining</Badge>}
                            </TD>
                            <TD className="text-right text-ink/60">
                              {formatINR(m.prev_price)} → <strong className="text-ink">{formatINR(m.new_price)}</strong>
                              <span className={`ml-1 ${m.direction === "up" ? "text-red-600" : "text-emerald-600"}`}>
                                {m.change_pct > 0 ? "+" : ""}{formatPct(m.change_pct * 100)}
                              </span>
                            </TD>
                            <TD className="text-right">
                              {m.units_change_pct != null
                                ? <span className={m.units_change_pct < 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-600"}>
                                    {m.units_change_pct > 0 ? "+" : ""}{formatPct(m.units_change_pct * 100)}
                                  </span>
                                : <span className="text-ink/40">no prior sales</span>}
                            </TD>
                          </TR>
                        ))}
                      </tbody>
                    </Table>
                    <p className="mt-3 text-[11px] leading-relaxed text-ink/40">{pricing.data.interpretation_note}</p>
                  </CardBody>
                </Card>
              </div>
            )}
          </Section>

          {/* ── 4 · Promotions ──────────────────────────────────────────── */}
          <Section icon={<BadgePercent className="h-4 w-4" />} n="04" title="What are promotions actually buying us?"
            lead="Campaign → orders → revenue → margin. The discount is paid out of margin; the organic baseline is the same products outside campaign windows.">
            {promos.data && (
              <div className="space-y-4">
                {promos.data.campaigns.map((c: CampaignStats) => (
                  <Card key={c.id}>
                    <CardBody className="py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-display text-sm font-semibold text-ink">{c.name}</p>
                          <p className="text-[11px] text-ink/40">{c.kind} · {c.start} → {c.end} · {formatPct(c.discount_pct * 100)} off</p>
                        </div>
                        {(c.margin_rate ?? 0) < 0.15 && <Badge tone="red" dot>margin under pressure</Badge>}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        <FunnelStat label="Orders" value={formatNumber(c.orders ?? 0)} />
                        <FunnelStat label="Revenue (gross)" value={formatINR(c.revenue ?? 0)} />
                        <FunnelStat label="AOV vs organic" value={c.aov_delta_pct != null ? `${c.aov_delta_pct > 0 ? "+" : ""}${formatPct(c.aov_delta_pct * 100)}` : "—"}
                          tone={c.aov_delta_pct != null && c.aov_delta_pct < 0 ? "red" : "ink"} />
                        <FunnelStat label="Discount cost" value={formatINR(c.discount_cost ?? 0)} tone="red" />
                        <FunnelStat label="Margin (delivered)" value={formatINR(c.margin ?? 0)} />
                        <FunnelStat label="Margin rate vs organic"
                          value={c.margin_rate != null ? formatPct(c.margin_rate * 100) : "—"}
                          sub={c.organic_margin_rate != null ? `organic ${formatPct(c.organic_margin_rate * 100)}` : undefined}
                          tone={c.margin_rate != null && c.organic_margin_rate != null && c.margin_rate < c.organic_margin_rate ? "red" : "ink"} />
                      </div>
                    </CardBody>
                  </Card>
                ))}
                <Card>
                  <CardBody className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-4">
                    <FunnelStat label="Campaign orders (90d)" value={formatNumber(promos.data.totals.orders)} />
                    <FunnelStat label="Revenue" value={formatINR(promos.data.totals.revenue)} />
                    <FunnelStat label="Total discount cost" value={formatINR(promos.data.totals.discount_cost)} tone="red" />
                    <FunnelStat label="Margin after discounts" value={formatINR(promos.data.totals.margin)} />
                  </CardBody>
                </Card>
                <p className="text-[11px] leading-relaxed text-ink/40">{promos.data.tradeoff_note}</p>
              </div>
            )}
          </Section>
        </Stagger>
      )}
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function HeadlineStrip({ procurement, catalog, pricing, promos }: {
  procurement?: ProcurementLinkage;
  catalog?: CatalogQuality;
  pricing?: PricingIntel;
  promos?: PromotionsIntel;
}) {
  return (
    <StaggerItem>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Suppliers with risk linkage" value={String(procurement?.flagged.length ?? "—")} unit="of 15"
          accent={(procurement?.flagged.length ?? 0) > 3 ? "red" : "yellow"}
          info="Suppliers whose measured inbound slippage coincides with stock-out exposure on the products they feed." />
        <KpiCard label="Catalog completeness" value={catalog ? formatPct(catalog.complete_pct) : "—"} unit="of attributes"
          accent={(catalog?.complete_pct ?? 100) < 85 ? "yellow" : "green"}
          info="Share of color / material / description / image attributes present across the catalog. Missing size charts on sized products feed the returns problem." />
        <KpiCard label="Avg product margin" value={pricing?.avg_margin_pct != null ? formatPct(pricing.avg_margin_pct * 100) : "—"} unit="list basis"
          accent={(pricing?.avg_margin_pct ?? 0) < 0.3 ? "red" : "green"}
          info="Mean margin across products with sales in the window, before campaign discounting." />
        <KpiCard label="Discount cost (90d)" value={promos ? formatINR(promos.totals.discount_cost) : "—"} unit="given away"
          accent="violet"
          info="Total price conceded on campaign-attributed orders — what the revenue lift cost in margin." />
      </div>
    </StaggerItem>
  );
}

function Section({ icon, n, title, lead, children }: {
  icon: React.ReactNode; n: string; title: string; lead: string; children: React.ReactNode;
}) {
  const reduce = false;
  return (
    <StaggerItem>
      <section aria-label={title}>
        <motion.div
          initial={reduce ? undefined : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
          className="mb-3 flex items-center gap-3"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/5 text-ink/60">{icon}</span>
          <h2 className="font-display text-sm font-semibold tracking-wide text-ink">{title}</h2>
          <span className="hidden font-mono text-[10px] text-ink/30 sm:inline">{n}</span>
          <span className="h-px flex-1 bg-ink/10" aria-hidden />
          <ArrowRight className="h-3 w-3 text-ink/20" aria-hidden />
        </motion.div>
        <p className="mb-3 text-xs text-ink/50">{lead}</p>
        {children}
      </section>
    </StaggerItem>
  );
}

function FunnelStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ink" | "red" }) {
  return (
    <div>
      <p className="text-[11px] text-ink/50">{label}</p>
      <p className={`font-display text-lg font-semibold ${tone === "red" ? "text-red-600 dark:text-red-400" : "text-ink"}`}>{value}</p>
      {sub && <p className="text-[10px] text-ink/40">{sub}</p>}
    </div>
  );
}
