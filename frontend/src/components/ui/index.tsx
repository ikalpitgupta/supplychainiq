// Lightweight shadcn-style component kit — flux design language, theme-aware
// via surface/panel/ink tokens that flip with [data-theme].
import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { HelpCircle, Inbox, Loader2, X, XCircle } from "lucide-react";
import { Link } from "react-router-dom";

/* ---------------------------------- Card --------------------------------- */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl bg-surface shadow-card ${className}`}>{children}</div>
  );
}

export function CardHeader({
  title, subtitle, right, icon,
}: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-chrome text-lime-300">{icon}</div>}
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink/50">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 pb-5 pt-4 ${className}`}>{children}</div>;
}

/* --------------------------------- Button -------------------------------- */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "lime";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-chrome text-white hover:bg-chrome-soft border-transparent",
  secondary: "bg-surface text-ink border-ink/15 hover:bg-ink/5",
  ghost: "bg-transparent text-ink/60 border-transparent hover:bg-ink/5",
  danger: "bg-red-600 text-white hover:bg-red-700 border-transparent",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 border-transparent",
  lime: "bg-lime-300 text-chrome hover:bg-lime-400 border-transparent",
};

export function Button({ variant = "primary", size = "md", loading, className = "", children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60 ${
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
      } ${buttonVariants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

/* --------------------------------- Badge --------------------------------- */
export type BadgeTone = "green" | "yellow" | "red" | "blue" | "gray" | "violet";
const badgeTones: Record<BadgeTone, string> = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  yellow: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
  red: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25",
  blue: "bg-brand-500/10 text-brand-700 dark:text-brand-300 border-brand-500/25",
  gray: "bg-ink/5 text-ink/60 border-ink/10",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25",
};

export function Badge({ tone = "gray", children, dot = false, className = "" }:
  { tone?: BadgeTone; children: ReactNode; dot?: boolean; className?: string }) {
  const dotColor: Record<BadgeTone, string> = {
    green: "bg-emerald-500", yellow: "bg-amber-500", red: "bg-red-500",
    blue: "bg-brand-500", gray: "bg-ink/40", violet: "bg-violet-500",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${badgeTones[tone]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColor[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}

/* --------------------------------- Tables -------------------------------- */
export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`scrollbar-thin overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}
export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/40">{children}</thead>;
}
export function TH({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-4 py-3 font-medium ${className}`}>{children}</th>;
}
export function TR({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-ink/5 last:border-0 ${onClick ? "cursor-pointer hover:bg-ink/5" : ""} ${className}`}
    >
      {children}
    </tr>
  );
}
export function TD({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

/* --------------------------------- Dialog -------------------------------- */
export function Dialog({
  open, onClose, title, children, width = "md",
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: "md" | "lg" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) {
      document.addEventListener("keydown", onKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-chrome/60" onClick={onClose} aria-hidden />
      <div ref={ref} className={`relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-3xl bg-surface shadow-float ${width === "lg" ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="sticky top-0 flex items-center justify-between rounded-t-3xl bg-surface px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="rounded-full p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 pb-5 pt-1">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = "Confirm", danger = false, loading = false,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string;
  message: string; confirmLabel?: string; danger?: boolean; loading?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="text-sm text-ink/70">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} size="sm" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/* --------------------------- Inputs and Selects --------------------------- */
export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-full border border-ink/10 bg-surface px-4 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 disabled:bg-ink/5 ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full appearance-none rounded-full border border-ink/10 bg-surface px-4 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink/60">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink/40">{hint}</span>}
    </label>
  );
}

/* -------------------------------- Skeleton ------------------------------- */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-ink/10 ${className}`} aria-hidden />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </CardBody>
    </Card>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/* ------------------------- Empty and Error states ------------------------ */
export function EmptyState({ title, message, action }:
  { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-lime-300/25 p-3 text-ink/50"><Inbox className="h-5 w-5" /></div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {message && <p className="max-w-sm text-xs text-ink/50">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }:
  { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-red-500/10 p-3 text-red-500"><XCircle className="h-5 w-5" /></div>
      <p className="text-sm font-medium text-ink">Something went wrong</p>
      <p className="max-w-sm text-xs text-ink/50">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>Try again</Button>
      )}
    </div>
  );
}

/* ------------------------------- InfoTip --------------------------------- */
export function InfoTip({ text, label, dark = false }: { text: string; label?: string; dark?: boolean }) {
  return (
    <span className="group relative inline-flex items-center">
      {label && <span className={`mr-1 text-xs ${dark ? "text-white/50" : "text-ink/50"}`}>{label}</span>}
      <HelpCircle className={`h-3.5 w-3.5 cursor-help ${dark ? "text-white/40" : "text-ink/30"}`} aria-label={text} />
      <span className={`pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-56 -translate-x-1/2 rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-lg group-hover:block ${
        dark ? "bg-white text-ink" : "bg-chrome text-white"
      }`}>
        {text}
      </span>
    </span>
  );
}

/* ------------------------------- Tabs ------------------------------------ */
export function Tabs({ tabs, active, onChange }:
  { tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-full bg-ink/5 p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            active === t.id ? "bg-chrome text-white shadow-sm" : "text-ink/50 hover:text-ink"
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${active === t.id ? "bg-lime-300 text-chrome" : "bg-ink/10 text-ink/60"}`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Pagination ------------------------------- */
export function Pagination({ page, pageSize, total, onPage }:
  { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between px-5 py-4 text-xs text-ink/50">
      <span>
        Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {formatNum(total)}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="px-2">Page {page} of {pages}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

function formatNum(n: number): string {
  return n.toLocaleString("en-IN");
}

/* ---------------------------- Page link helper --------------------------- */
export function LinkButton({ to, variant = "secondary", size = "sm", children }:
  { to: string; variant?: ButtonVariant; size?: ButtonSize; children: ReactNode }) {
  const cls = buttonVariants[variant];
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border font-medium transition-colors ${
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
      } ${cls}`}
    >
      {children}
    </Link>
  );
}
