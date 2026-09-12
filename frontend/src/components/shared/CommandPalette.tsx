// Ctrl+K command palette — global search + quick actions (spec #30/#31).
// Products and suppliers come from the live API; pages/actions are real
// routes. Full keyboard navigation, recents in localStorage, Framer Motion
// transitions consistent with the app's modal language (AboutModal).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftRight, Boxes, CornerDownLeft, Database, FlaskConical, FileUp,
  Handshake, LayoutDashboard, Package, PackageOpen, PackageSearch, Radar, Search, Settings,
  Sparkles, Truck, TrendingUp, Zap,
} from "lucide-react";
import { productsApi, suppliersApi } from "../../api/endpoints";
import type { ProductRow, SupplierScore } from "../../types";
import { EASE } from "../motion";

type Section = "Actions" | "Pages" | "Products" | "Suppliers";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  section: Section;
  icon: React.ReactNode;
  run: (nav: (to: string) => void) => void;
}

const PAGES: Array<{ to: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { to: "/", label: "Command Center", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/forecast", label: "Demand Forecast", icon: TrendingUp },
  { to: "/fulfillment", label: "Fulfillment", icon: PackageSearch },
  { to: "/delivery", label: "Delivery", icon: Truck },
  { to: "/returns", label: "Returns", icon: ArrowLeftRight },
  { to: "/suppliers", label: "Suppliers", icon: Handshake },
  { to: "/inbound", label: "Inbound Intelligence", icon: PackageOpen },
  { to: "/inbound", label: "Inbound Intelligence", icon: PackageOpen },
  { to: "/insights", label: "Insights & Actions", icon: Sparkles },
  { to: "/simulator", label: "Scenario Lab", icon: FlaskConical },
  { to: "/intelligence", label: "Intelligence", icon: Radar },
  { to: "/data-quality", label: "Data Quality", icon: Database },
  { to: "/import", label: "Import data", icon: FileUp },
  { to: "/settings", label: "Settings", icon: Settings },
];

const ACTIONS: Cmd[] = [
  { id: "act-critical", label: "View critical inventory", hint: "Filtered list", section: "Actions", icon: <Zap className="h-4 w-4 text-red-500" />, run: (nav) => nav("/inventory?status=Critical") },
  { id: "act-recs", label: "Review actions required", hint: "Insights & Actions", section: "Actions", icon: <Sparkles className="h-4 w-4 text-lime-500" />, run: (nav) => nav("/insights") },
  { id: "act-forecast", label: "Run forecast", hint: "Demand forecast page", section: "Actions", icon: <PackageSearch className="h-4 w-4 text-brand-500" />, run: (nav) => nav("/forecast") },
  { id: "act-po", label: "Create purchase order", hint: "Fulfillment create form", section: "Actions", icon: <PackageSearch className="h-4 w-4 text-brand-500" />, run: (nav) => nav("/fulfillment") },
  { id: "act-sim", label: "Open scenario lab", hint: "What-if analysis", section: "Actions", icon: <FlaskConical className="h-4 w-4 text-brand-500" />, run: (nav) => nav("/simulator") },
];

const RECENTS_KEY = "sciq.palette.recents";
const MAX_VISIBLE = 12;

function fmoney(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function readRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[]; } catch { return []; }
}

function pushRecent(id: string) {
  const next = [id, ...readRecents().filter((r) => r !== id)].slice(0, 5);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

function fmatch(needle: string, ...haystacks: Array<string | undefined>): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => h?.toLowerCase().includes(q));
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const nav = (to: string) => { onClose(); navigate(to); };

  // Live search — only while open, keyed by query.
  const productsQ = useQuery({
    queryKey: ["palette-products", query],
    queryFn: () => productsApi.list({ search: query || undefined, page_size: 6 }),
    enabled: open,
    staleTime: 30_000,
  });
  const suppliersQ = useQuery({
    queryKey: ["palette-suppliers", query],
    queryFn: () => suppliersApi.list({ search: query || undefined }),
    enabled: open,
    staleTime: 30_000,
  });

  const staticCmds: Cmd[] = useMemo(() => {
    const pages: Cmd[] = PAGES.map(({ to, label, icon: Icon }) => ({
      id: `page:${to}`, label, section: "Pages", icon: <Icon className="h-4 w-4 text-ink/50" />,
      run: (n) => n(to),
    }));
    return [...ACTIONS, ...pages];
  }, []);

  const recents = useMemo(() => (open ? readRecents() : []), [open, query]);

  const all: Cmd[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const productCmds: Cmd[] = (productsQ.data?.items ?? []).map((p: ProductRow) => ({
      id: `product:${p.id}`,
      label: p.name,
      hint: `${p.sku} · ${p.category} · ${p.current_stock} on hand${p.inventory_value ? ` · ${fmoney(p.inventory_value)}` : ""}`,
      section: "Products",
      icon: <Package className="h-4 w-4 text-brand-500" />,
      run: (n) => n(`/products/${p.id}`),
    }));
    const supplierCmds: Cmd[] = (suppliersQ.data?.items ?? []).map((s: SupplierScore) => ({
      id: `supplier:${s.supplier_id ?? s.id}`,
      label: s.name,
      hint: `Score ${Math.round(s.total)}/100 · ${(s.on_time_rate * 100).toFixed(0)}% on-time`,
      section: "Suppliers",
      icon: <Truck className="h-4 w-4 text-brand-500" />,
      run: (n) => n(`/suppliers/${s.supplier_id ?? s.id}`),
    }));

    const filteredStatic = staticCmds.filter((c) => fmatch(q, c.label, c.hint));
    const filteredProducts = q
      ? productCmds.filter((c) => fmatch(q, c.label, c.hint))
      : productCmds;
    const filteredSuppliers = q
      ? supplierCmds.filter((c) => fmatch(q, c.label, c.hint))
      : supplierCmds;

    // Recents first when the query is empty.
    if (!q && recents.length) {
      const byId = new Map([...filteredStatic, ...filteredProducts, ...filteredSuppliers].map((c) => [c.id, c]));
      const recentCmds = recents.map((id) => byId.get(id)).filter((c): c is Cmd => Boolean(c)).slice(0, 4);
      const rest = [...filteredStatic, ...filteredProducts, ...filteredSuppliers].filter((c) => !recents.includes(c.id));
      return [...recentCmds, ...rest].slice(0, MAX_VISIBLE);
    }
    return [...filteredStatic, ...filteredProducts, ...filteredSuppliers].slice(0, MAX_VISIBLE);
  }, [query, staticCmds, productsQ.data, suppliersQ.data, recents]);

  useEffect(() => setActive(0), [query, all.length]);

  // Reset state when opening; focus the input.
  useEffect(() => {
    if (open) { setQuery(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  // Keyboard: arrows / enter / escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, all.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); all[active]?.run(nav); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, all, active, onClose]);

  // Keep the active row in view.
  useEffect(() => {
    listRef.current?.querySelector("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastSection: Section | null = null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
          <motion.div className="absolute inset-0 bg-chrome/60 backdrop-blur-sm" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} />
          <motion.div
            className="relative w-full max-w-xl overflow-hidden rounded-3xl bg-surface shadow-float"
            initial={{ opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }} transition={{ duration: 0.18, ease: EASE }}
          >
            <div className="flex items-center gap-3 border-b border-ink/10 px-5 py-4">
              <Search className="h-4 w-4 text-ink/30" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products, suppliers, pages — or type a command…"
                aria-label="Command palette search"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink/30 focus:outline-none"
              />
              <kbd className="rounded-md bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold text-ink/40">Esc</kbd>
            </div>

            <div ref={listRef} className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2">
              {all.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-ink/40">
                  No matches for “{query}” — try a product, supplier, or page name.
                </p>
              )}
              {all.map((c, i) => {
                const header = c.section !== lastSection ? c.section : null;
                lastSection = c.section;
                return (
                  <div key={c.id}>
                    {header && (
                      <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-ink/35">{header}</p>
                    )}
                    <button
                      data-active={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => { pushRecent(c.id); c.run(nav); }}
                      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                        i === active ? "bg-brand-500/10 text-ink" : "text-ink/80"
                      }`}
                    >
                      {c.icon}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.label}</span>
                        {c.hint && <span className="block truncate text-xs text-ink/40">{c.hint}</span>}
                      </span>
                      {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink/30" />}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-3 border-t border-ink/10 px-5 py-2.5 text-[10px] text-ink/35">
              <span><kbd className="font-semibold">↑↓</kbd> navigate</span>
              <span><kbd className="font-semibold">↵</kbd> open</span>
              <span className="ml-auto"><kbd className="font-semibold">Ctrl K</kbd> toggle</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
