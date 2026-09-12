// Browser-tab identity: per-route document titles ("Inventory · SupplyChainIQ")
// and a favicon alert-badge so critical actions surface outside the app.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { recommendationsApi } from "../api/endpoints";

const BASE = "SupplyChainIQ";

const ROUTE_TITLES: [prefix: string, section: string][] = [
  ["/inventory", "Inventory"],
  ["/forecast", "Demand Forecast"],
  ["/fulfillment", "Fulfillment"],
  ["/delivery", "Delivery"],
  ["/returns", "Returns"],
  ["/suppliers", "Suppliers"],
  ["/insights", "Insights & Actions"],
  ["/simulator", "Scenario Lab"],
  ["/intelligence", "Intelligence"],
  ["/data-quality", "Data Quality"],
  ["/import", "Import"],
  ["/settings", "Settings"],
  ["/login", "Sign in"],
];

function routeTitle(pathname: string): string {
  for (const [prefix, section] of ROUTE_TITLES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return `${section} · ${BASE}`;
  }
  // Product detail and any other detail views
  if (pathname.startsWith("/products/")) return `Product · ${BASE}`;
  return BASE;
}

/* ------------------------- Favicon alert badge --------------------------- *
 * Draws the 32px icon plus a lime dot with the alert count in the corner,
 * entirely on a canvas — no asset swapping needed.
 * ------------------------------------------------------------------------ */
let baseIcon: HTMLImageElement | null = null;

function loadBaseIcon(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (baseIcon?.complete) return resolve(baseIcon);
    const img = new Image();
    img.onload = () => { baseIcon = img; resolve(img); };
    img.onerror = reject;
    img.src = "/favicon-32x32.png";
  });
}

function drawBadgeIcon(count: number): string {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d");
  if (!ctx || !baseIcon) return "/favicon-32x32.png";
  ctx.drawImage(baseIcon, 0, 0, 32, 32);

  // Badge disc (lime, chrome ring)
  ctx.beginPath();
  ctx.arc(25, 25, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#d6f06e";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#171812";
  ctx.stroke();

  // Count text (capped display)
  const label = count > 9 ? "9+" : String(count);
  ctx.fillStyle = "#171812";
  ctx.font = "bold 9px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 25, 25.5);
  return c.toDataURL("image/png");
}

export function useTabIdentity(authed: boolean = true) {
  const location = useLocation();

  // Per-route titles
  useEffect(() => {
    document.title = routeTitle(location.pathname);
  }, [location.pathname]);

  // Alert-count favicon badge (updates live with the recommendations feed)
  const recsQ = useQuery({
    queryKey: ["recommendations-badge"],
    queryFn: recommendationsApi.get,
    staleTime: 60_000,
    select: (d) => d.counts.critical + d.counts.warning,
    retry: 1,
    enabled: authed,
  });
  const alerts = recsQ.data ?? 0;

  useEffect(() => {
    let cancelled = false;
    const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon'][type='image/png']");
    if (!favicon) return;

    loadBaseIcon()
      .then(() => {
        if (cancelled) return;
        favicon.href = alerts > 0 ? drawBadgeIcon(alerts) : "/favicon-32x32.png";
      })
      .catch(() => { /* favicon badge is best-effort */ });

    return () => { cancelled = true; };
  }, [alerts]);
}
