import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity, ArrowDown, Boxes, ClipboardList, Factory, Gauge, Search,
  ShoppingCart, TriangleAlert, Warehouse, Zap,
} from "lucide-react";
import { intelligenceApi } from "../api/endpoints";
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton, Tabs } from "../components/ui";
import { PageHeader } from "../components/shared";
import { Stagger, StaggerItem } from "../components/motion";
import { formatINR, formatNumber } from "../utils/format";
import type { AnomalyItem, ControlTowerStage } from "../types";

const STAGE_ICONS: Record<string, typeof Factory> = {
  SUPPLIERS: Factory,
  "PURCHASE ORDERS": ClipboardList,
  WAREHOUSE: Warehouse,
  INVENTORY: Boxes,
  CUSTOMERS: ShoppingCart,
};

function scoreTone(score: number) {
  if (score >= 85) return { bar: "bg-emerald-500", text: "text-emerald-400", badge: "green" as const };
  if (score >= 70) return { bar: "bg-lime-400", text: "text-lime-300", badge: "lime" as never };
  if (score >= 55) return { bar: "bg-amber-400", text: "text-amber-400", badge: "yellow" as const };
  return { bar: "bg-red-500", text: "text-red-400", badge: "red" as const };
}

function StageCard({ stage }: { stage: ControlTowerStage }) {
  const Icon = STAGE_ICONS[stage.stage] ?? Boxes;
  const tone = scoreTone(stage.score);
  const critical = stage.alerts.filter((a) => a.tier === "CRITICAL");
  return (
    <StaggerItem className="min-w-0 flex-1">
      <Card className="flex h-full flex-col">
        <CardBody className="flex h-full flex-col gap-3 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-chrome text-white">
                <Icon className="h-4.5 w-4.5" size={18} aria-hidden />
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide text-ink">{stage.stage}</p>
                <p className="text-[11px] text-ink/50">{stage.detail}</p>
              </div>
            </div>
            <div className="text-right">
              <p className={`font-display text-2xl font-semibold ${tone.text}`}>{Math.round(stage.score)}</p>
              <p className="text-[10px] uppercase tracking-wider text-ink/40">health</p>
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${stage.score}%` }} />
          </div>
          <div className="mt-auto space-y-1.5">
            {stage.issues > 0 ? (
              stage.alerts.slice(0, 3).map((a) => (
                <Link
                  key={`${a.id}-${a.name}`}
                  to={a.link}
                  className="block rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2 transition-colors hover:bg-ink/[0.07]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-ink">{a.name}</span>
                    <Badge tone={a.tier === "CRITICAL" ? "red" : a.tier === "HIGH" ? "yellow" : "blue"} dot>
                      {a.tier}
                    </Badge>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-ink/50">{a.detail}</p>
                </Link>
              ))
            ) : (
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-400">
                No open issues at this stage.
              </p>
            )}
            {stage.issues > stage.alerts.length && (
              <p className="px-1 text-[11px] text-ink/40">
                +{stage.issues - Math.min(stage.alerts.length, 3)} more issues
                {critical.length > 0 ? ` · ${critical.length} critical` : ""}
              </p>
            )}
          </div>
        </CardBody>
      </Card>
    </StaggerItem>
  );
}

function AnomalyRow({ a }: { a: AnomalyItem }) {
  const isSpike = a.direction === "spike";
  return (
    <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={isSpike ? "yellow" : "blue"} dot>
            <Zap size={11} className="mr-1 inline" aria-hidden />
            {isSpike ? "SPIKE" : "DROP"}
          </Badge>
          <span className="text-sm font-medium text-ink">{a.label}</span>
          {a.sku && <span className="text-[11px] text-ink/40">{a.sku}</span>}
        </div>
        <span className="font-display text-sm font-semibold text-ink">
          z = {a.z.toFixed(1)}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-ink/60">{a.explanation}</p>
      {a.spike_action?.applies && (
        <p className="mt-2 rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          {a.spike_action.recommendation}
        </p>
      )}
      {a.investigate_link && (
        <Link
          to={a.investigate_link}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-lime-300 hover:underline"
        >
          <Search size={12} aria-hidden /> Investigate
        </Link>
      )}
    </div>
  );
}

export default function ControlTowerPage() {
  const tower = useQuery({ queryKey: ["control-tower"], queryFn: intelligenceApi.controlTower });
  const anomalies = useQuery({ queryKey: ["anomalies"], queryFn: () => intelligenceApi.anomalies(2.5) });
  const [tab, setTab] = useState("demand");

  const demandAnoms = anomalies.data?.anomalies ?? [];
  const delayAnoms = anomalies.data?.supplier_delays ?? [];
  const shown = tab === "demand" ? demandAnoms : delayAnoms;

  return (
    <div>
      <PageHeader
        title="Control Tower"
        subtitle="End-to-end supply chain health across every stage, refreshed from live data."
        right={tower.data ? (
          <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-2.5 shadow-card">
            <Gauge className="h-5 w-5 text-lime-300" aria-hidden />
            <div>
              <p className="font-display text-xl font-semibold text-ink">{Math.round(tower.data.overall_score)}</p>
              <p className="text-[10px] uppercase tracking-wider text-ink/40">network score · {tower.data.period_days}d</p>
            </div>
          </div>
        ) : null}
      />

      {tower.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : tower.isError ? (
        <ErrorState message="Failed to load the control tower." onRetry={() => tower.refetch()} />
      ) : (
        <div className="mb-8">
          <Stagger className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {(tower.data?.stages ?? []).map((stage, i) => (
              <div key={stage.stage} className="contents">
                {i > 0 && (
                  <div className="hidden items-center lg:flex" aria-hidden>
                    <ArrowDown className="h-5 w-5 -rotate-90 text-ink/30" />
                  </div>
                )}
                <StageCard stage={stage} />
              </div>
            ))}
          </Stagger>
        </div>
      )}

      <Card>
        <CardHeader
          icon={<Activity size={15} aria-hidden />}
          title="Anomaly detection"
          subtitle={
            anomalies.data
              ? `${demandAnoms.length} demand anomalies · ${delayAnoms.length} supplier delays — rolling z-score over a ${anomalies.data.window_days}-day baseline, threshold ${anomalies.data.threshold}σ across ${formatNumber(anomalies.data.scanned)} series points`
              : "Scanning…"
          }
        />
        <CardBody>
          <div className="mb-4">
            <Tabs
              tabs={[
                { id: "demand", label: `Demand (${demandAnoms.length})` },
                { id: "delays", label: `Supplier delays (${delayAnoms.length})` },
              ]}
              active={tab}
              onChange={setTab}
            />
          </div>
          {anomalies.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : anomalies.isError ? (
            <ErrorState message="Failed to load anomalies." onRetry={() => anomalies.refetch()} />
          ) : shown.length === 0 ? (
            <p className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-6 text-sm text-emerald-400">
              <TriangleAlert size={15} aria-hidden className="hidden" />
              No anomalies above the {anomalies.data?.threshold ?? 2.5}σ threshold — demand and deliveries are within normal variation.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {shown.map((a) => (
                <AnomalyRow key={`${a.series}-${a.key}-${a.date ?? ""}`} a={a} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {tower.data?.summary && (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(tower.data.summary).map(([k, v]) => (
            <Card key={k} className="px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider text-ink/40">{k.replace(/_/g, " ")}</p>
              <p className="font-display text-lg font-semibold text-ink">
                {typeof v === "number" && k.includes("value") ? formatINR(v) : formatNumber(Number(v)) || v}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
