import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Target } from "lucide-react";
import { productsApi } from "../api/endpoints";
import { Card, CardBody, CardHeader, EmptyState, ErrorState, InfoTip, Select, Skeleton, Tabs } from "../components/ui";
import { DemandForecastChart } from "../components/charts";
import { KpiCard, PageHeader } from "../components/shared";
import { formatPct } from "../utils/format";
import type { ForecastResponse } from "../types";

const HORIZONS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
];

export default function ForecastPage() {
  const options = useQuery({ queryKey: ["product-options"], queryFn: productsApi.options });
  const [productId, setProductId] = useState<number | undefined>();
  const [horizon, setHorizon] = useState(30);
  const [category, setCategory] = useState("");

  const effectiveId = productId ?? options.data?.items?.[0]?.id;
  const categories = useMemo(
    () => Array.from(new Set((options.data?.items ?? []).map((o) => o.category))).sort(),
    [options.data],
  );

  const fc = useQuery({
    queryKey: ["forecast", effectiveId, horizon],
    queryFn: () => productsApi.forecast(effectiveId as number, horizon),
    enabled: !!effectiveId,
  });

  // Merge history + forecast into one chart series with CI band on the tail.
  const chartData = useMemo(() => {
    if (!fc.data) return [];
    const hist = fc.data.history.slice(-90).map((h) => ({
      date: h.date, actual: h.quantity, forecast: null as number | null,
      lower: null as number | null, upper: null as number | null,
    }));
    const fct = fc.data.forecast.map((f: ForecastResponse["forecast"][number]) => ({
      date: f.date, actual: null, forecast: f.yhat, lower: f.lower, upper: f.upper,
    }));
    // bridge point so the dashed line connects visually
    if (hist.length && fct.length) fct[0].forecast = fct[0].forecast;
    return [...hist, ...fct];
  }, [fc.data]);

  const productMeta = options.data?.items.find((o) => o.id === effectiveId);

  return (
    <div className="cascade">
      <PageHeader
        title="Demand Forecast"
        subtitle="Explainable per-product forecasting with held-out accuracy metrics."
        right={
          <>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44" aria-label="Category filter">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select
              value={effectiveId ?? ""}
              onChange={(e) => setProductId(Number(e.target.value))}
              className="w-56"
              aria-label="Product selector"
            >
              {(options.data?.items ?? [])
                .filter((o) => !category || o.category === category)
                .map((o) => <option key={o.id} value={o.id}>{o.name} ({o.sku})</option>)}
            </Select>
          </>
        }
      />

      <div className="mb-4">
        <Tabs tabs={HORIZONS} active={String(horizon)} onChange={(id) => setHorizon(Number(id))} />
      </div>

      {options.isError && <Card><ErrorState message="Could not load products" onRetry={() => options.refetch()} /></Card>}
      {fc.isError && <Card><ErrorState message={(fc.error as Error)?.message || "Forecast failed"} onRetry={() => fc.refetch()} /></Card>}

      {fc.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      )}

      {fc.data && (
        <div className="space-y-4">
          {/* Method + metrics */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="p-4 lg:col-span-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-ink/50">
                <BarChart3 className="h-3.5 w-3.5" /> Forecast method
              </p>
              <p className="mt-2 text-lg font-semibold text-ink">{fc.data.method}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink/50">
                Candidates (Moving Average 14d/28d, Exponential Smoothing) are backtested on a held-out tail;
                the lowest-RMSE method is used. No advanced AI is claimed — this is a transparent baseline.
              </p>
            </Card>
            <KpiCard label="MAE" value={fc.data.metrics.MAE?.toFixed(1) ?? "—"} unit="units"
              info="Mean Absolute Error on the held-out test tail — average miss size in units." />
            <KpiCard label="RMSE" value={fc.data.metrics.RMSE?.toFixed(1) ?? "—"} unit="units"
              info="Root Mean Squared Error — like MAE but penalizes large misses more heavily." />
          </div>

          <Card>
            <CardHeader
              title={`Will demand for ${productMeta?.name ?? "this product"} hold up?`}
              subtitle="Actual demand (90d window) with forecast and 95% confidence interval"
              right={<span className="text-xs text-ink/35">MAPE {fc.data.metrics.MAPE !== null ? formatPct(fc.data.metrics.MAPE) : "n/a"}</span>}
            />
            <CardBody>
              {chartData.length === 0 ? (
                <EmptyState title="Not enough history to forecast this product" message="Forecasts need at least 14 days of demand data." />
              ) : (
                <DemandForecastChart data={chartData} height={320} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="How accurate is this forecast?" subtitle="Computed on a train/test split (last tail held out)" icon={<Target className="h-4 w-4" />} />
            <CardBody className="grid grid-cols-1 gap-3 text-xs text-ink/70 sm:grid-cols-3">
              <div className="rounded-lg bg-ink/5 p-3">
                <p className="font-semibold text-ink">MAE — {fc.data.metrics.MAE?.toFixed(2) ?? "n/a"} units</p>
                <p className="mt-1">On a typical day the forecast misses by about this many units.</p>
              </div>
              <div className="rounded-lg bg-ink/5 p-3">
                <p className="font-semibold text-ink">RMSE — {fc.data.metrics.RMSE?.toFixed(2) ?? "n/a"} units</p>
                <p className="mt-1">Large errors dominate this number; much bigger than MAE means occasional big misses.</p>
              </div>
              <div className="rounded-lg bg-ink/5 p-3">
                <p className="font-semibold text-ink">MAPE — {fc.data.metrics.MAPE !== null ? formatPct(fc.data.metrics.MAPE) : "n/a"}</p>
                <p className="mt-1">Average percentage error — easy to compare across products. <InfoTip text="Mean Absolute Percentage Error = mean of |actual − forecast| / actual. Unstable when demand is near zero, so treat with care for spiky products." /></p>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}


