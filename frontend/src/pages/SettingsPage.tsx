import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck, Crown, Database, LogOut, Mail, Moon, RotateCcw, Save,
  ShieldCheck, SlidersHorizontal, Sun, UserCircle2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { settingsApi } from "../api/endpoints";
import {
  Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Field,
  Input, Select, Skeleton, InfoTip,
} from "../components/ui";
import { PageHeader } from "../components/shared";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { useToast } from "../hooks/useToast";

/* --------------------------- Profile (flux card) -------------------------- */
function ProfileCard() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const initials = user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="relative overflow-hidden rounded-3xl bg-chrome p-6 shadow-float">
      {/* Ambient brand glow, echoing the login hero */}
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-blue-600/25 blur-3xl" />

      <div className="relative flex items-center gap-4">
        {/* Avatar */}
        <div className="relative">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 font-display text-xl font-bold text-white ring-2 ring-white/20">
            {initials || "?"}
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-chrome ${
              isAdmin ? "bg-lime-300 text-chrome" : "bg-white/20 text-white"
            }`}
            title={isAdmin ? "Administrator" : "Manager"}
          >
            {isAdmin ? <Crown className="h-3 w-3" /> : <UserCircle2 className="h-3.5 w-3.5" />}
          </span>
        </div>

        <div className="min-w-0">
          <p className="truncate font-display text-xl font-semibold tracking-tight text-white">{user.name}</p>
          <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-white/50">
            <Mail className="h-3 w-3 shrink-0" /> {user.email}
          </p>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-lime-300">
            <BadgeCheck className="h-3 w-3" /> {isAdmin ? "Administrator" : "Manager"}
          </span>
        </div>
      </div>

      <div className="relative mt-5 border-t border-white/10 pt-4">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-white/45">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
          {isAdmin
            ? "Full access — can reset demo data and change all business parameters."
            : "Standard access — can browse analytics and create purchase orders."}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full !border-white/15 !bg-white/10 !text-white hover:!bg-white/15"
          onClick={() => { logout(); navigate("/login"); }}
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </Button>
      </div>
    </div>
  );
}

/* --------------------------- Appearance selector -------------------------- */
function AppearanceCard() {
  const { theme, toggle } = useTheme();
  return (
    <Card>
      <CardHeader title="Appearance" subtitle="Theme preference is saved on this device" icon={<Sun className="h-4 w-4" />} />
      <CardBody>
        <div className="grid grid-cols-2 gap-3">
          {(["light", "dark"] as const).map((t) => {
            const active = theme === t;
            const Icon = t === "light" ? Sun : Moon;
            return (
              <button
                key={t}
                onClick={() => { if (!active) toggle(); }}
                aria-pressed={active}
                className={`flex flex-col items-center gap-2 rounded-2xl border px-4 py-4 text-xs font-semibold transition-all ${
                  active
                    ? "border-brand-500 bg-brand-500/10 text-ink ring-2 ring-brand-500/25"
                    : "border-ink/10 bg-panel text-ink/50 hover:border-ink/25 hover:text-ink"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "text-brand-500" : ""}`} />
                {t === "light" ? "Light" : "Dark"}
                {active && <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[9px] uppercase tracking-wider text-white">Active</span>}
              </button>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

/* --------------------------------- Page ---------------------------------- */
export default function SettingsPage() {
  const { user, isAdmin } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });

  const [form, setForm] = useState<Record<string, string>>({});
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (q.data) {
      const next: Record<string, string> = {};
      Object.entries(q.data.values).forEach(([k, v]) => { next[k] = String(v.value); });
      setForm(next);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const values: Record<string, number | string> = {};
      Object.entries(form).forEach(([k, v]) => {
        const kind = q.data?.values[k]?.kind;
        if (kind === "float") values[k] = parseFloat(v);
        else if (kind === "int") values[k] = parseInt(v, 10);
        else values[k] = v;
      });
      return settingsApi.update(values);
    },
    onSuccess: () => {
      push("success", "Settings saved — recalculations use the new assumptions immediately");
      qc.invalidateQueries();
    },
    onError: (e) => push("error", e instanceof Error ? e.message : "Failed to save settings"),
  });

  const reset = useMutation({
    mutationFn: settingsApi.resetDemo,
    onSuccess: (res) => {
      push("success", `${res.message} (${res.counts.products} products, ${res.counts.purchase_orders} POs)`);
      setConfirmReset(false);
      qc.invalidateQueries();
    },
    onError: (e) => {
      push("error", e instanceof Error ? e.message : "Reset failed");
      setConfirmReset(false);
    },
  });

  if (q.isError) return <Card><ErrorState message={(q.error as Error)?.message || "Failed to load settings"} onRetry={() => q.refetch()} /></Card>;

  const groups: { title: string; icon: React.ReactNode; keys: string[]; note?: string }[] = [
    {
      title: "Inventory parameters", icon: <SlidersHorizontal className="h-4 w-4" />,
      keys: ["service_level", "demand_window_days", "low_stock_fraction", "overstock_days"],
      note: "These drive safety stock (Z × σ × √LT), reorder points, and status classification across the whole app.",
    },
    {
      title: "Ordering & holding cost (demo assumptions)", icon: <Database className="h-4 w-4" />,
      keys: ["ordering_cost", "holding_cost_rate"],
      note: "Used by the EOQ order-quantity recommendation. These are illustrative demo assumptions, not real company figures.",
    },
    {
      title: "User preferences", icon: <SlidersHorizontal className="h-4 w-4" />,
      keys: ["currency", "date_format", "forecast_days"],
    },
  ];

  return (
    <div className="cascade">
      <PageHeader
        title="Settings"
        subtitle="Your account, appearance, and business parameters."
        right={
          <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!q.data}>
            <Save className="h-3.5 w-3.5" /> Save changes
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column: identity + appearance */}
        <div className="space-y-4">
          <ProfileCard />
          <AppearanceCard />
          <Card>
            <CardHeader title="Demo data" subtitle="Regenerate the synthetic dataset" icon={<RotateCcw className="h-4 w-4" />} />
            <CardBody>
              {!isAdmin ? (
                <p className="text-xs leading-relaxed text-ink/50">
                  Only admin users can reset demo data. You are signed in as <strong className="text-ink">{user?.name}</strong> ({user?.role}).
                </p>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-ink/70">
                    Regenerates all products, suppliers, sales, inventory history, and purchase orders with a
                    new consistent dataset. Purchase orders you created manually will be removed.
                  </p>
                  <Button variant="danger" size="sm" className="mt-3" onClick={() => setConfirmReset(true)} loading={reset.isPending}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right column: business parameters */}
        <div className="space-y-4 lg:col-span-2">
          {q.isLoading && <Skeleton className="h-64 w-full" />}

          {q.data && (
            <>
              {groups.map((g) => (
                <Card key={g.title}>
                  <CardHeader title={g.title} icon={g.icon} />
                  <CardBody>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {g.keys.filter((k) => q.data!.values[k]).map((k) => {
                        const meta = q.data!.values[k];
                        return (
                          <Field key={k} label={meta.label || k} hint={meta.kind !== "str" ? `Type: ${meta.kind}` : undefined}>
                            {k === "currency" ? (
                              <Select value={form[k] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}>
                                <option value="INR">INR (₹)</option>
                                <option value="USD">USD ($)</option>
                                <option value="EUR">EUR (€)</option>
                              </Select>
                            ) : k === "date_format" ? (
                              <Select value={form[k] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}>
                                <option value="DD MMM YYYY">DD MMM YYYY</option>
                                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                              </Select>
                            ) : k === "service_level" ? (
                              <Select value={form[k] ?? "0.95"} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}>
                                <option value="0.90">90% (Z=1.28)</option>
                                <option value="0.95">95% (Z=1.65)</option>
                                <option value="0.98">98% (Z=2.05)</option>
                                <option value="0.99">99% (Z=2.33)</option>
                              </Select>
                            ) : (
                              <Input
                                type={meta.kind === "str" ? "text" : "number"}
                                step={meta.kind === "float" ? "0.01" : undefined}
                                value={form[k] ?? ""}
                                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                              />
                            )}
                          </Field>
                        );
                      })}
                    </div>
                    {g.note && (
                      <p className="mt-3 rounded-2xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                        <strong>Demo assumptions:</strong> {g.note}
                      </p>
                    )}
                  </CardBody>
                </Card>
              ))}

              <p className="flex items-center gap-1.5 px-1 text-xs text-ink/35">
                Assumptions marked "demo" are illustrative figures for the recommendation engine.
                <InfoTip text="EOQ and safety-stock outputs are only as good as their cost and service-level inputs. In production these would come from finance and S&OP." />
              </p>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => reset.mutate()}
        title="Reset demo data?"
        message="All current products, sales, inventory history, and purchase orders will be replaced with a freshly generated dataset. This cannot be undone."
        confirmLabel="Reset demo data"
        danger
        loading={reset.isPending}
      />
    </div>
  );
}
