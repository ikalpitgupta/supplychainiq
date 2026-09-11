// Money/number/date formatting helpers (INR demo currency).

export function formatINR(value: number | null | undefined, compact = true): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (compact) {
    if (Math.abs(value) >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)} Cr`;
    if (Math.abs(value) >= 1_00_000) return `₹${(value / 1_00_000).toFixed(2)} L`;
    if (Math.abs(value) >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`;
  }
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-IN");
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return "No recent demand";
  return `${value.toFixed(value < 10 ? 1 : 0)} days`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatMonth(ym: string): string {
  const d = new Date(ym + "-01T00:00:00");
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

export function formatDelta(pct: number | null | undefined): { text: string; dir: "up" | "down" | "flat" } {
  if (pct === null || pct === undefined) return { text: "—", dir: "flat" };
  const dir = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
  return { text: `${Math.abs(pct).toFixed(1)}%`, dir };
}
