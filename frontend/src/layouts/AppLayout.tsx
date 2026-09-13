import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Bell, Boxes, ChevronDown, Database, FileUp, FlaskConical, GitBranch, Handshake, Info,
  LayoutDashboard, LogOut, Menu, Moon, PackageOpen, PackageSearch, PlayCircle, Search, Settings,
  Sparkles, Sun, Truck, X, BrainCircuit,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { PageTransition } from "../hooks/usePageTransition";
import { recommendationsApi } from "../api/endpoints";
import { LogoMark } from "../components/LogoMark";
import { AboutModal } from "../components/shared/AboutModal";
import { CommandPalette } from "../components/shared/CommandPalette";
import { DemoTour } from "../components/shared/DemoTour";

// Business journey: DEMAND → INVENTORY → FULFILLMENT → DELIVERY → SUPPLIERS →
// INSIGHTS & ACTIONS → SCENARIO LAB. Platform tools live in their own group.
const NAV_PRIMARY = [
  { to: "/", label: "Command Center", icon: LayoutDashboard, end: true },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/fulfillment", label: "Fulfillment", icon: PackageSearch },
  { to: "/delivery", label: "Delivery", icon: Truck },
  { to: "/suppliers", label: "Suppliers", icon: Handshake },
  { to: "/inbound", label: "Inbound Intelligence", icon: PackageOpen },
  { to: "/insights", label: "Insights & Actions", icon: Sparkles, badge: true },
  { to: "/root-cause", label: "Root Cause Analysis", icon: GitBranch },
  { to: "/product-intelligence", label: "Product Intelligence", icon: BrainCircuit },
  { to: "/simulator", label: "Scenario Lab", icon: FlaskConical },
];
const NAV_TOOLS = [
  { to: "/data-quality", label: "Data Quality", icon: Database },
  { to: "/import", label: "Import data", icon: FileUp },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Real badge: count of open (non-info) recommendations.
  const recsQ = useQuery({
    queryKey: ["recommendations-badge"],
    queryFn: recommendationsApi.get,
    staleTime: 60_000,
    select: (d) => d.counts.critical + d.counts.warning + d.counts.opportunity,
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Global Ctrl+K / Cmd+K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openPalette = () => setPaletteOpen(true);

  // The sidebar is fixed dark chrome in both themes — brand anchor.
  const sidebarBody = (onClick?: () => void) => (
    <div className="flex h-full w-64 flex-col rounded-3xl bg-chrome shadow-float">
      <div className="flex items-center gap-3 px-5 pb-2 pt-6">
        <LogoMark tagline="Fashion Commerce Supply Chain Intelligence" />
      </div>

      <nav className="flex-1 space-y-1 px-4 py-2" aria-label="Main navigation">
        {NAV_PRIMARY.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClick}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "bg-surface text-ink shadow-sm" : "text-white/60 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{label}</span>
            {badge && (recsQ.data ?? 0) > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-lime-300 px-1.5 text-[10px] font-bold text-chrome">
                {recsQ.data}
              </span>
            )}
          </NavLink>
        ))}
        <p className="px-4 pb-1 pt-4 text-[10px] font-bold uppercase tracking-widest text-white/30">Platform</p>
        {NAV_TOOLS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClick}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? "bg-surface text-ink shadow-sm" : "text-white/50 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 space-y-3">
        <button
          onClick={() => { setTourOpen(true); onClick?.(); }}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-white/20 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-lime-300/60"
        >
          <PlayCircle className="h-3.5 w-3.5" /> Run Demo Scenario
        </button>
        <div className="rounded-3xl bg-lime-300 p-4">
          <p className="font-display text-base font-semibold text-chrome">Actions required</p>
          <p className="mt-0.5 text-xs leading-relaxed text-chrome/70">
            {recsQ.data ?? 0} recommendation{recsQ.data === 1 ? "" : "s"} waiting on a decision.
          </p>
          <button
            onClick={() => { navigate("/insights"); onClick?.(); }}
            className="mt-3 w-full rounded-full bg-chrome px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-chrome-soft"
          >
            Review now
          </button>
        </div>
        <button
          onClick={() => setAboutOpen(true)}
          className="flex w-full items-center gap-2 px-1 text-[10px] text-white/40 transition-colors hover:text-white/70 focus:outline-none focus:ring-2 focus:ring-lime-300/60 rounded"
        >
          <Info className="h-3 w-3" /> About This Analysis
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen gap-4 overflow-hidden bg-canvas p-4 transition-colors duration-300 md:gap-5 md:p-6">
      <aside className="hidden md:block">{sidebarBody()}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-chrome/60" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute left-0 top-0 h-full p-3">{sidebarBody(() => setMobileOpen(false))}</div>
          <button
            className="absolute right-4 top-4 rounded-full bg-surface p-2 text-ink shadow"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-panel shadow-float transition-colors duration-300">
        {/* Floating panel header */}
        <header className="flex items-center gap-3 px-4 py-3 md:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-full bg-surface p-2 text-ink shadow-sm md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>

          <div className="relative md:ml-0" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen((o) => !o)}
              className="flex items-center gap-2.5 rounded-full bg-surface py-1.5 pl-1.5 pr-3 shadow-sm transition-shadow hover:shadow"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
                {user?.name?.split(" ").map((w) => w[0]).slice(0, 2).join("") || "?"}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-xs font-semibold leading-tight text-ink">{user?.name}</span>
                <span className="block text-[10px] leading-tight text-ink/40">{user?.email}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-ink/40" />
            </button>
            {userMenuOpen && (
              <div role="menu" className="absolute left-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-2xl bg-surface py-1 shadow-float">
                <button
                  role="menuitem"
                  onClick={() => { setUserMenuOpen(false); navigate("/settings"); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-xs text-ink/70 hover:bg-ink/5"
                >
                  <Settings className="h-3.5 w-3.5" /> Settings
                </button>
                <button
                  role="menuitem"
                  onClick={() => { logout(); navigate("/login"); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-xs text-red-500 hover:bg-red-500/10"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </div>
            )}
          </div>

          <button
            onClick={openPalette}
            aria-label="Open command palette"
            className="ml-auto hidden w-64 items-center gap-3 rounded-full border border-ink/10 bg-surface py-2 pl-4 pr-2 text-sm text-ink/40 shadow-sm transition-colors hover:border-brand-500/40 sm:flex lg:w-80"
          >
            <Search className="h-4 w-4 text-ink/30" />
            <span className="flex-1 text-left">Search everything…</span>
            <kbd className="rounded-md bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold text-ink/40">Ctrl K</kbd>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            className="rounded-full bg-surface p-2.5 text-ink shadow-sm transition-transform hover:scale-105 active:scale-95"
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>

          <button
            onClick={() => navigate("/insights")}
            aria-label="Open actions required"
            className="relative rounded-full bg-surface p-2.5 text-ink shadow-sm transition-shadow hover:shadow"
          >
            <Bell className="h-4 w-4" />
            {(recsQ.data ?? 0) > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-chrome px-1 text-[9px] font-bold text-lime-300">
                {recsQ.data}
              </span>
            )}
          </button>
        </header>

        {/* Mobile search → palette trigger */}
        <div className="px-4 pb-1 sm:hidden">
          <button
            onClick={openPalette}
            aria-label="Open command palette"
            className="flex w-full items-center gap-3 rounded-full border border-ink/10 bg-surface py-2 pl-4 pr-3 text-sm text-ink/40"
          >
            <Search className="h-4 w-4 text-ink/30" />
            <span className="flex-1 text-left">Search everything…</span>
          </button>
        </div>

        <main className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-6 md:px-6">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>

        <div className="pointer-events-none flex items-center gap-1 px-6 pb-3 text-[10px] text-ink/25">
          <AlertTriangle className="h-3 w-3" /> Demo environment — synthetic data
        </div>
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <DemoTour open={tourOpen} onClose={() => setTourOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
