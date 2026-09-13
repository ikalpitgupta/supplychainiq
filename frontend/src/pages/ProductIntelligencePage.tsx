// Product Intelligence — a PM analytics tool, not a chatbot.
// Answers are composed by the analytics layer; the AI (when configured) only
// polishes prose under a no-new-numbers rule. The UI makes the grounding
// visible: every answer shows its evidence, confidence and data quality, and
// questions the data cannot support get the honest refusal.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck, Beaker, BrainCircuit, ChevronRight, CircleAlert, ClipboardCheck,
  FileText, FlaskConical, Lightbulb, ListChecks, Scale, ShieldQuestion, Sparkles,
} from "lucide-react";
import { piApi } from "../api/endpoints";
import { Button, Card, CardBody, CardHeader, ErrorState, Input, Skeleton } from "../components/ui";
import { PageHeader } from "../components/shared";
import { Stagger, StaggerItem } from "../components/motion";
import type { PiConfidence, PiExperiment } from "../types";

const LEVEL_STYLE: Record<PiConfidence["level"], string> = {
  high: "bg-emerald-500/15 text-emerald-400",
  medium: "bg-sky-400/15 text-sky-400",
  low: "bg-amber-400/15 text-amber-400",
};

function ConfidenceBadge({ c }: { c: PiConfidence }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${LEVEL_STYLE[c.level]}`}
      title={c.note}
    >
      <BadgeCheck size={12} aria-hidden /> {c.level} confidence
      <span className="font-normal opacity-80">· {c.note}</span>
    </span>
  );
}

function ExperimentBlock({ exp }: { exp: PiExperiment }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-4 text-sm">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink/50">
        <FlaskConical size={12} aria-hidden /> Suggested experiment
      </p>
      <p className="text-ink"><span className="text-ink/50">Hypothesis:</span> {exp.hypothesis}</p>
      <p className="mt-1 text-ink"><span className="text-ink/50">Primary KPI:</span> {exp.primary_kpi}
        {exp.guardrail && <> <span className="text-ink/50">· Guardrail:</span> {exp.guardrail}</>}
      </p>
      {exp.sample_size_per_arm != null && (
        <p className="mt-1 text-xs text-ink/50">
          n ≈ {exp.sample_size_per_arm.toLocaleString("en-IN")}/arm{exp.basis ? ` — ${exp.basis}` : ""}
        </p>
      )}
    </div>
  );
}

const Bullets = ({ items, icon, tone = "text-ink/80" }: { items: (string | null | undefined)[]; icon: React.ReactNode; tone?: string }) => (
  <ul className="space-y-1.5 text-sm">
    {items.filter(Boolean).map((t, i) => (
      <li key={i} className={`flex gap-2 ${tone}`}>
        <span className="mt-0.5 shrink-0 text-ink/35">{icon}</span>
        <span className="min-w-0">{t}</span>
      </li>
    ))}
  </ul>
);

export default function ProductIntelligencePage() {
  const meta = useQuery({ queryKey: ["pi-questions"], queryFn: piApi.questions });
  const [question, setQuestion] = useState("Why is delivery performance declining?");
  const [asked, setAsked] = useState<string | null>(null);

  const [recommendation, setRecommendation] = useState("Rebalance SLA-bound orders away from the worst carrier");
  const [validated, setValidated] = useState<string | null>(null);

  const [problem, setProblem] = useState<string | undefined>(undefined);

  const answer = useQuery({
    queryKey: ["pi-ask", asked],
    queryFn: () => piApi.ask(asked as string),
    enabled: !!asked,
  });
  const validation = useQuery({
    queryKey: ["pi-validate", validated],
    queryFn: () => piApi.validate(validated as string),
    enabled: !!validated,
  });
  const experiments = useQuery({
    queryKey: ["pi-experiments", problem],
    queryFn: () => piApi.experiments(problem),
  });
  const summary = useQuery({ queryKey: ["pi-summary"], queryFn: piApi.executiveSummary });

  const ask = (q?: string) => setAsked((q ?? question).trim());

  return (
    <div className="cascade">
      <PageHeader
        title="Product Intelligence"
        subtitle="Grounded in your analytics — every number traceable to a measured table, or the answer says so."
        right={meta.data && (
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${LEVEL_STYLE[meta.data.data_quality.score >= 95 ? "high" : meta.data.data_quality.score >= 90 ? "medium" : "low"]}`}>
            Data quality {meta.data.data_quality.score}/100 · {meta.data.data_quality.status}
          </span>
        )}
      />

      <Stagger className="space-y-5">
        {/* 1 · Ask */}
        <StaggerItem>
          <Card>
            <CardHeader
              icon={<BrainCircuit size={15} aria-hidden />}
              title="Ask Product Intelligence"
              subtitle="Structured answers: insight → evidence → drivers → recommendation → KPI → experiment."
            />
            <CardBody className="space-y-4">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => { e.preventDefault(); ask(); }}
              >
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. Why is delivery performance declining?"
                  aria-label="Ask a question about the business"
                  className="flex-1"
                />
                <Button type="submit" disabled={question.trim().length < 3 || answer.isFetching}>
                  <Sparkles size={14} className="mr-1" aria-hidden /> {answer.isFetching ? "Analyzing…" : "Ask"}
                </Button>
              </form>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested questions">
                {(meta.data?.questions ?? []).map((q) => (
                  <button
                    key={q.id}
                    onClick={() => { setQuestion(q.q); ask(q.q); }}
                    disabled={!q.answerable}
                    title={q.answerable ? q.q : "Insufficient data in the current window"}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      q.answerable
                        ? "border-ink/10 bg-ink/[0.02] text-ink/70 hover:border-lime-400/40 hover:text-lime-300"
                        : "cursor-not-allowed border-ink/[0.06] text-ink/25"
                    }`}
                  >
                    {q.q}
                  </button>
                ))}
              </div>

              {answer.isFetching && <Skeleton className="h-56 w-full" />}
              {answer.isError && <ErrorState message="Could not compose an answer." onRetry={() => answer.refetch()} />}
              {answer.data && !answer.isFetching && (
                <div className={`rounded-2xl border p-5 ${answer.data.insufficient ? "border-amber-400/25 bg-amber-400/[0.04]" : "border-lime-400/20 bg-lime-400/[0.03]"}`}>
                  <p className="mb-3 flex items-start gap-2 font-display text-base font-semibold leading-snug text-ink">
                    {answer.data.insufficient
                      ? <ShieldQuestion size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden />
                      : <Lightbulb size={18} className="mt-0.5 shrink-0 text-lime-300" aria-hidden />}
                    {answer.data.insight}
                  </p>
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink/50">
                        <ListChecks size={12} aria-hidden /> Evidence
                      </p>
                      <Bullets items={answer.data.evidence} icon={<ChevronRight size={13} aria-hidden />} />
                      <p className="mb-1.5 mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink/50">
                        <CircleAlert size={12} aria-hidden /> Possible drivers
                      </p>
                      <Bullets items={answer.data.possible_drivers} icon={<ChevronRight size={13} aria-hidden />} />
                    </div>
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink/50">
                        <ClipboardCheck size={12} aria-hidden /> Recommendation
                      </p>
                      <p className="text-sm text-ink/90">{answer.data.recommendation}</p>
                      {answer.data.kpi_to_track.length > 0 && (
                        <>
                          <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink/50">KPI to track</p>
                          <div className="flex flex-wrap gap-1.5">
                            {answer.data.kpi_to_track.map((k) => (
                              <span key={k} className="rounded-full bg-ink/[0.05] px-2.5 py-1 text-xs text-ink/70">{k}</span>
                            ))}
                          </div>
                        </>
                      )}
                      {answer.data.investigate.length > 0 && (
                        <>
                          <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink/50">Investigate next</p>
                          <Bullets items={answer.data.investigate} icon={<ChevronRight size={13} aria-hidden />} />
                        </>
                      )}
                    </div>
                  </div>
                  {answer.data.experiment && (
                    <div className="mt-4"><ExperimentBlock exp={answer.data.experiment} /></div>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/[0.07] pt-3">
                    <ConfidenceBadge c={answer.data.confidence} />
                    {answer.data.narrative_source && (
                      <span className="text-[11px] text-ink/40">Narrative: {answer.data.narrative_source}</span>
                    )}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </StaggerItem>

        {/* 2 · Validate */}
        <StaggerItem>
          <Card>
            <CardHeader
              icon={<Scale size={15} aria-hidden />}
              title="Validate a recommendation"
              subtitle="Supporting evidence, risks, missing information, KPI and experiment — against the measured data."
            />
            <CardBody className="space-y-4">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => { e.preventDefault(); setValidated(recommendation.trim()); }}
              >
                <Input
                  value={recommendation}
                  onChange={(e) => setRecommendation(e.target.value)}
                  placeholder="e.g. Pre-position high-demand sizes in South warehouses"
                  aria-label="Recommendation to validate"
                  className="flex-1"
                />
                <Button type="submit" variant="secondary" disabled={recommendation.trim().length < 3 || validation.isFetching}>
                  <ClipboardCheck size={14} className="mr-1" aria-hidden /> Validate
                </Button>
              </form>
              {validation.isFetching && <Skeleton className="h-44 w-full" />}
              {validation.isError && <ErrorState message="Validation failed." onRetry={() => validation.refetch()} />}
              {validation.data && !validation.isFetching && (
                <div className="rounded-2xl border border-ink/10 p-5">
                  <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-ink">
                    <BadgeCheck size={16} className="mt-0.5 shrink-0 text-lime-300" aria-hidden />
                    {validation.data.verdict}
                  </p>
                  <div className="grid gap-5 md:grid-cols-3">
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400/80">Supporting evidence</p>
                      <Bullets items={validation.data.supporting_evidence} icon={<ChevronRight size={13} aria-hidden />} />
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400/80">Potential risks</p>
                      <Bullets items={validation.data.potential_risks} icon={<ChevronRight size={13} aria-hidden />} />
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink/50">Missing information</p>
                      <Bullets items={validation.data.missing_information} icon={<ChevronRight size={13} aria-hidden />} tone="text-ink/60" />
                    </div>
                  </div>
                  {validation.data.suggested_experiment && (
                    <div className="mt-4"><ExperimentBlock exp={validation.data.suggested_experiment} /></div>
                  )}
                  <div className="mt-4 border-t border-ink/[0.07] pt-3">
                    <ConfidenceBadge c={validation.data.confidence} />
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </StaggerItem>

        {/* 3 · Experiments + 4 · Executive summary */}
        <div className="grid gap-5 lg:grid-cols-2">
          <StaggerItem>
            <Card className="h-full">
              <CardHeader
                icon={<Beaker size={15} aria-hidden />}
                title="Product experiment ideas"
                subtitle="Designed on measured baselines — sample sizes from the two-proportion approximation."
              />
              <CardBody className="space-y-3">
                {(meta.data?.detected_problems.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setProblem(undefined)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${!problem ? "bg-lime-400/15 text-lime-300" : "bg-ink/[0.04] text-ink/60"}`}>
                      All detected problems
                    </button>
                    {meta.data!.detected_problems.map((p) => (
                      <button key={p} onClick={() => setProblem(p)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${problem === p ? "bg-lime-400/15 text-lime-300" : "bg-ink/[0.04] text-ink/60"}`}>
                        {p}
                      </button>
                    ))}
                  </div>
                )}
                {experiments.isLoading && <Skeleton className="h-40 w-full" />}
                {experiments.data && experiments.data.ideas.length === 0 && (
                  <p className="text-sm text-amber-400/90">{experiments.data.note}</p>
                )}
                {experiments.data?.ideas.map((idea) => (
                  <div key={idea.problem_id} className="rounded-2xl border border-ink/10 p-4 text-sm">
                    <p className="font-medium text-ink">{idea.title}</p>
                    <p className="mt-1 text-ink/70"><span className="text-ink/45">Hypothesis:</span> {idea.hypothesis}</p>
                    {idea.design && <p className="mt-1 text-ink/60">{idea.design}</p>}
                    <p className="mt-1.5 text-xs text-ink/50">
                      <span className="font-semibold text-ink/70">{idea.primary_kpi}</span> · guardrail: {idea.guardrail} · n ≈ {idea.sample_size_per_arm.toLocaleString("en-IN")}/arm
                    </p>
                    <p className="mt-1 text-[11px] text-ink/40">{idea.basis}</p>
                  </div>
                ))}
                {experiments.data && <p className="text-[11px] text-ink/40">{experiments.data.note}</p>}
              </CardBody>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card className="h-full">
              <CardHeader
                icon={<FileText size={15} aria-hidden />}
                title="Executive summary"
                subtitle="Analytics in business language — nothing asserted that is not measured."
                right={summary.data && <ConfidenceBadge c={summary.data.confidence} />}
              />
              <CardBody className="space-y-3">
                {summary.isLoading && <Skeleton className="h-40 w-full" />}
                {summary.data && (
                  <>
                    <p className="font-display text-sm font-semibold leading-snug text-ink">{summary.data.headline}</p>
                    <ul className="space-y-1.5 text-sm text-ink/80">
                      {summary.data.summary.map((s, i) => (
                        <li key={i} className="flex gap-2"><span className="text-ink/35">·</span>{s}</li>
                      ))}
                    </ul>
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-lime-300/80">Do next</p>
                      <Bullets items={summary.data.actions} icon={<ChevronRight size={13} aria-hidden />} />
                    </div>
                    <details className="text-xs text-ink/40">
                      <summary className="cursor-pointer select-none hover:text-ink/60">What this environment does not measure</summary>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4">
                        {summary.data.not_measured.map((n, i) => <li key={i}>{n}</li>)}
                      </ul>
                    </details>
                  </>
                )}
              </CardBody>
            </Card>
          </StaggerItem>
        </div>
      </Stagger>
    </div>
  );
}
