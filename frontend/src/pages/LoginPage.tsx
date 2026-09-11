import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowRight, CheckCircle2, Crown, Lock, Mail, ShieldCheck, TrendingUp, Users,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { Input } from "../components/ui";
import { LogoMark } from "../components/LogoMark";

const DEMOS = [
  { email: "admin@supplychainiq.com", password: "admin123", role: "Admin", icon: Crown },
  { email: "manager@supplychainiq.com", password: "manager123", role: "Manager", icon: Users },
];

const VALUE_POINTS = [
  "Live stock-out risks and reorder recommendations",
  "Explainable forecasts with accuracy metrics",
  "Supplier scorecards and ABC analytics",
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    // Fixed dark backdrop: the brand lockup (blue tile + white wordmark) and the
    // diorama are designed against it, in both app themes.
    <div className="relative min-h-screen overflow-hidden bg-[#0a1220]">
      {/* Ambient blue glow echoing the diorama artwork */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-blue-600/20 blur-[120px]" />
        <div className="absolute -bottom-40 left-1/3 h-[460px] w-[460px] rounded-full bg-blue-500/15 blur-[130px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl items-center gap-10 px-4 py-8 md:px-10 lg:gap-14">
        {/* Left: floating hero element — the SupplyChainIQ diorama */}
        <div className="relative hidden flex-1 flex-col lg:flex">
          <LogoMark size="lg" tagline="Decision Support" />

          {/* The diorama, floating on the dark canvas with a blue halo */}
          <div className="animate-fade-float relative mt-10 [animation-delay:120ms]">
            <div aria-hidden className="absolute -inset-6 rounded-[2.5rem] bg-blue-600/20 blur-3xl" />
            <img
              src="/warehouse-diorama.jpg"
              alt="SupplyChainIQ fulfillment hub — a miniature warehouse with trucks and a forklift"
              className="relative w-full rounded-[2rem] shadow-[0_50px_120px_-30px_rgba(37,99,235,0.55)] ring-1 ring-white/10"
              draggable={false}
            />
            {/* Floating capability chip, echoing the reference's "Anticipate" bubble */}
            <div className="animate-fade-float absolute -top-4 right-6 rounded-2xl bg-surface/95 px-4 py-2.5 text-xs font-semibold text-ink shadow-lg backdrop-blur [animation-delay:720ms]">
              Anticipate. Optimize. <span className="text-blue-600">Procure smarter.</span>
            </div>
          </div>

          {/* Social proof under the hero */}
          <div className="mt-8 space-y-2.5">
            {VALUE_POINTS.map((point) => (
              <div key={point} className="flex items-center gap-2.5 text-sm text-white/75">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-lime-300" />
                {point}
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-2 border-t border-white/10 pt-5 text-xs text-white/40">
            <ShieldCheck className="h-4 w-4 text-blue-400" />
            Trusted by operations teams to keep shelves stocked and cash flowing
            <TrendingUp className="ml-auto h-4 w-4 text-lime-300" />
          </div>
        </div>

        {/* Right: the authentication form — the primary focus */}
        <div className="flex w-full max-w-md flex-1 flex-col justify-center">
          {/* Compact brand for small screens where the hero is hidden */}
          <div className="mb-8 lg:hidden">
            <LogoMark size="lg" tagline="Decision Support" />
          </div>

          <div className="animate-fade-slide-up rounded-[2rem] bg-surface p-8 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.5)] [animation-delay:240ms] md:p-10">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Welcome back</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              Sign in to continue to <span className="font-medium text-ink/70">SupplyChainIQ</span>
            </p>

            <form onSubmit={submit} className="mt-7 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-ink/70">Email</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
                  <Input
                    type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com" autoComplete="username" className="!pl-10"
                  />
                </div>
              </label>
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink/70">Password</span>
                  <span className="cursor-not-allowed text-xs text-ink/30" title="Demo only">Forgot password?</span>
                </span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
                  <Input
                    type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" autoComplete="current-password" className="!pl-10"
                  />
                </div>
              </label>
              {error && (
                <p role="alert" className="rounded-2xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/35 transition-all hover:bg-blue-700 hover:shadow-blue-600/50 hover:animate-none disabled:opacity-60 animate-glow-pulse [animation-delay:1s]"
              >
                {busy ? "Signing in…" : <>Sign in <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>

            <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-widest text-ink/30">
              <span className="h-px flex-1 bg-ink/10" /> or <span className="h-px flex-1 bg-ink/10" />
            </div>

            <p className="text-xs font-semibold text-ink/70">One-click demo access</p>
            <div className="mt-2.5 space-y-2">
              {DEMOS.map((d) => (
                <button key={d.email}
                  onClick={() => { setEmail(d.email); setPassword(d.password); }}
                  className="flex w-full items-center justify-between gap-2 rounded-full bg-panel px-3.5 py-2.5 text-left text-xs ring-1 ring-ink/10 transition-all hover:bg-lime-50 hover:ring-blue-400"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                      <d.icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="shrink-0 font-semibold text-ink">{d.role}</span>
                    <span className="truncate text-ink/40">{d.email}</span>
                  </span>
                  <span className="shrink-0 font-medium text-blue-600">Fill →</span>
                </button>
              ))}
            </div>

            <p className="mt-6 text-center text-xs text-ink/40">
              New here?{" "}
              <button type="button" onClick={() => { setEmail(DEMOS[1].email); setPassword(DEMOS[1].password); }}
                className="font-semibold text-blue-600 hover:text-blue-700">
                Explore the demo →
              </button>
            </p>
          </div>

          <p className="mt-5 text-center text-[10px] uppercase tracking-[0.25em] text-ink/30">
            Data → Decisions → A stronger tomorrow
          </p>
        </div>
      </div>
    </div>
  );
}
