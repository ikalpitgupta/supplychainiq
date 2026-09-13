// Contextual Product Intelligence strip — grounds the "Why?" section of the
// Command Center with one composed answer from the /api/pi engine (the same
// deterministic, no-invented-numbers layer as the full page).
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BrainCircuit, ChevronRight, CircleHelp, Sparkles } from "lucide-react";
import { piApi } from "../../api/endpoints";
import { Badge, Card, CardBody, CardHeader, Skeleton } from "../ui";
import type { PiConfidence } from "../../types";

const LEVEL_TONE: Record<PiConfidence["level"], "green" | "yellow" | "gray"> = {
  high: "green", medium: "yellow", low: "gray",
};

export function PiInsightCard({ question }: { question: string }) {
  const q = useQuery({
    queryKey: ["pi-context", question],
    queryFn: () => piApi.ask(question),
    staleTime: 120_000,
  });

  return (
    <Card>
      <CardHeader
        icon={<BrainCircuit size={15} aria-hidden />}
        title="What Product Intelligence says"
        subtitle="Composed from the analytics layer — every figure traces to a measured table."
        right={q.data && (
          <Link to="/product-intelligence" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
            Ask your own <ChevronRight size={13} aria-hidden />
          </Link>
        )}
      />
      <CardBody>
        {q.isLoading && <Skeleton className="h-24 w-full" />}
        {q.isError && (
          <p className="flex items-center gap-2 text-xs text-ink/50">
            <CircleHelp size={14} aria-hidden /> Product Intelligence is unavailable right now.
          </p>
        )}
        {q.data && (
          <div className="space-y-3">
            <p className="text-sm font-medium leading-relaxed text-ink">
              <Sparkles size={14} className="mr-1.5 inline text-lime-500" aria-hidden />
              {q.data.insight}
            </p>
            <ul className="space-y-1 text-xs leading-relaxed text-ink/60">
              {q.data.evidence.filter(Boolean).slice(0, 2).map((e, i) => (
                <li key={i} className="flex gap-1.5"><span className="text-ink/30">·</span>{e}</li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2 border-t border-ink/[0.07] pt-2.5">
              <Badge tone={LEVEL_TONE[q.data.confidence.level]} dot>{q.data.confidence.level} confidence</Badge>
              <span className="text-[11px] text-ink/40">{q.data.confidence.note}</span>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
