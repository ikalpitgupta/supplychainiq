import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, CheckCircle2 } from "lucide-react";
import { api } from "../api/client";
import { Card, CardBody, CardHeader, ErrorState, SkeletonCard } from "../components/ui";
import { PageHeader } from "../components/shared";
import { AnimatedNumber } from "../components/motion";
import { Link } from "react-router-dom";

interface DQCheck {
  name: string;
  description: string;
  records_checked: number;
  issues: Record<string, unknown>[];
  issue_count: number;
}
interface DQReport {
  score: number;
  checks: DQCheck[];
  total_issues: number;
  status: string;
}

export default function DataQualityPage() {
  const q = useQuery({
    queryKey: ["data-quality"],
    queryFn: () => api<DQReport>("/data-quality"),
  });

  const r = q.data;

  return (
    <div>
      <PageHeader
        title="Data Quality"
        subtitle="Automated scans of the live database — every analytics number is only as good as the data beneath it."
      />

      {q.isError && (
        <Card><ErrorState message={(q.error as Error)?.message || "Failed to load data quality report"} onRetry={() => q.refetch()} /></Card>
      )}

      {q.isLoading && (
        <div className="space-y-4">
          <SkeletonCard lines={3} />
          <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={4} />)}</div>
        </div>
      )}

      {r && (
        <div className="space-y-4">
          <Card>
            <CardBody className="flex flex-wrap items-center gap-8 py-6">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`Data quality score ${r.score} of 100`}>
                    <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-ink/8" />
                    <circle
                      cx="48" cy="48" r="40" fill="none"
                      stroke={r.score >= 97 ? "#059669" : r.score >= 90 ? "#d97706" : "#dc2626"}
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 40}
                      strokeDashoffset={2 * Math.PI * 40 * (1 - r.score / 100)}
                      transform="rotate(-90 48 48)"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <AnimatedNumber value={r.score} format={(n) => String(Math.round(n))} className="font-display text-2xl font-semibold text-ink" />
                    <span className="text-[9px] text-ink/40">/ 100</span>
                  </div>
                </div>
                <div>
                  <p className="font-display text-lg font-semibold text-ink">{r.status}</p>
                  <p className="mt-0.5 text-xs text-ink/50">{r.total_issues} total issues across {r.checks.length} checks</p>
                  <p className="mt-1 max-w-md text-[11px] leading-relaxed text-ink/40">
                    The score is the average pass rate across checks, weighted per check. A check with no issues passes fully;
                    sampled issues are counted conservatively.
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {r.checks.map((c) => {
              const ok = c.issue_count === 0;
              return (
                <Card key={c.name}>
                  <CardHeader
                    title={c.name}
                    subtitle={c.description}
                    icon={ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertOctagon className="h-4 w-4 text-amber-500" />}
                    right={
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      }`}>
                        {ok ? "clean" : `${c.issue_count} issue${c.issue_count === 1 ? "" : "s"}`}
                      </span>
                    }
                  />
                  <CardBody>
                    <p className="text-xs text-ink/50">{c.records_checked.toLocaleString("en-IN")} records checked</p>
                    {!ok && (
                      <ul className="mt-2 space-y-1">
                        {c.issues.slice(0, 5).map((issue, i) => (
                          <li key={i} className="rounded-lg bg-panel/70 px-2.5 py-1.5 font-mono text-[10px] text-ink/60">
                            {JSON.stringify(issue)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {c.name === "Products without supplier" && c.issue_count > 0 && (
                      <Link to="/inventory" className="mt-2 inline-block text-[11px] font-medium text-brand-600 hover:text-brand-700">
                        Assign suppliers in Inventory →
                      </Link>
                    )}
                    {c.name === "Suppliers without orders" && c.issue_count > 0 && (
                      <Link to="/purchase-orders" className="mt-2 inline-block text-[11px] font-medium text-brand-600 hover:text-brand-700">
                        Create a purchase order →
                      </Link>
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
