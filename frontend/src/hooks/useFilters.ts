import { useSearchParams } from "react-router-dom";

// Global dashboard filters: kept in the URL so views are shareable and
// every data query genuinely recomputes when a filter changes.
export function useDashboardFilters() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category");
  const period = Number(params.get("period") || 90);

  const setCategory = (c: string | null) => {
    const next = new URLSearchParams(params);
    if (c) next.set("category", c);
    else next.delete("category");
    setParams(next, { replace: true });
  };
  const setPeriod = (p: number) => {
    const next = new URLSearchParams(params);
    next.set("period", String(p));
    setParams(next, { replace: true });
  };
  return { category, period, setCategory, setPeriod };
}
