// CSV Import: drag-and-drop upload, column mapping, row-level validation,
// a server dry-run that diffs destructive upserts before they happen, and a
// before/after recommendations comparison so the operational impact is visible.
// Wizard flow: Upload → Map columns → Review rows (impact + confirm) → Result.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, Clock, Download,
  FileSpreadsheet, FileUp, RefreshCw, ShieldAlert, Sparkles, UploadCloud, X,
} from "lucide-react";
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton,
} from "../components/ui";
import { PageHeader } from "../components/shared";
import { useToast } from "../hooks/useToast";
import { downloadImportFile } from "../api/client";
import { ioApi, productsApi, recommendationsApi, suppliersApi } from "../api/endpoints";
import type { ImportPreview } from "../api/endpoints";
import type { ImportReport, Recommendation } from "../types";
import {
  ACCEPTED_IMPORT_TYPES, autoMap, buildMappedCsv, downloadTemplate, ENTITY_META,
  ENTITY_SPECS, isSpreadsheetFile, parseSpreadsheet, validateDataset,
  type ParsedCsv, type ValidationResult,
} from "../utils/csv";

type Step = "upload" | "map" | "review" | "result";

interface RecsSnapshot {
  counts: { critical: number; warning: number; opportunity: number; info: number };
  bySku: Map<string, Recommendation>;
}

function snapshotRecs(items: Recommendation[]): RecsSnapshot {
  const counts = { critical: 0, warning: 0, opportunity: 0, info: 0 };
  const bySku = new Map<string, Recommendation>();
  for (const r of items) {
    counts[r.severity] += 1;
    bySku.set(r.sku, r);
  }
  return { counts, bySku };
}

interface RecDelta {
  countsBefore: RecsSnapshot["counts"];
  countsAfter: RecsSnapshot["counts"];
  newAlerts: Recommendation[];
  changedAlerts: { sku: string; product: string; before: Recommendation; after: Recommendation }[];
  resolvedAlerts: Recommendation[];
}

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "map", label: "Map columns" },
  { id: "review", label: "Review rows" },
  { id: "result", label: "Import" },
];

export default function ImportPage() {
  const { push } = useToast();
  const qc = useQueryClient();
  const [entity, setEntity] = useState<string>("products");
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [recsBefore, setRecsBefore] = useState<RecsSnapshot | null>(null);
  const [recsDelta, setRecsDelta] = useState<RecDelta | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reference lists for SKU / supplier validation.
  const productsQ = useQuery({ queryKey: ["import-skus"], queryFn: () => productsApi.options() });
  const suppliersQ = useQuery({ queryKey: ["import-suppliers"], queryFn: () => suppliersApi.list({}) });

  // Audit trail: past imports, who ran them, re-download the exact files.
  const historyQ = useQuery({ queryKey: ["import-history"], queryFn: () => ioApi.history(50) });

  const skus = useMemo(() => (productsQ.data?.items ?? []).map((p) => p.sku), [productsQ.data]);
  const suppliers = useMemo(() => (suppliersQ.data?.items ?? []).map((s) => s.name), [suppliersQ.data]);

  const validation: ValidationResult | null = useMemo(() => {
    if (!data) return null;
    return validateDataset(entity, data, mapping, { skus, suppliers });
  }, [entity, data, mapping, skus, suppliers]);

  // Server-side dry-run on the mapped CSV: counts creates/updates and diffs
  // the rows that would overwrite existing products or suppliers.
  const mappingKey = JSON.stringify(mapping);
  const previewQ = useQuery({
    queryKey: ["import-preview", entity, file?.name, data?.rows.length, mappingKey],
    queryFn: () => {
      const csvText = buildMappedCsv(entity, data!, mapping);
      const f = new File([csvText], "preview.csv", { type: "text/csv" });
      return ioApi.importPreview(entity, f);
    },
    enabled: step === "review" && !!data,
    staleTime: 0,
  });
  const preview: ImportPreview | undefined = previewQ.data;

  // Overwrite confirmation must be re-granted whenever the plan changes.
  useEffect(() => { setConfirmOverwrite(false); }, [entity, mappingKey, file?.name]);
  const needsConfirm = (preview?.updates ?? 0) > 0;

  const reset = useCallback(() => {
    setFile(null);
    setData(null);
    setMapping({});
    setReport(null);
    setRecsBefore(null);
    setRecsDelta(null);
    setStep("upload");
  }, []);

  const acceptFile = useCallback((f: File) => {
    if (!isSpreadsheetFile(f)) {
      push("error", "Please choose a .csv or .xlsx file");
      return;
    }
    parseSpreadsheet(f)
      .then((parsed) => {
        setFile(f);
        setData(parsed);
        setMapping(autoMap(parsed.headers, ENTITY_SPECS[entity]));
        setReport(null);
        setStep("map");
      })
      .catch(() => push("error", "Could not read that file — no usable rows found"));
  }, [entity, push]);

  const switchEntity = (e: string) => {
    setEntity(e);
    setFile(null);
    setData(null);
    setMapping({});
    setReport(null);
    setRecsBefore(null);
    setRecsDelta(null);
    setStep("upload");
  };

  const importMutation = useMutation({
    mutationFn: async (csvText: string) => {
      // The wire format is always canonical CSV — XLSX files are converted
      // client-side, so the backend upload path never changes.
      const mapped = new File([csvText], (file?.name ?? "import.xlsx").replace(/\.(csv|txt|xlsx|xlsm|xls)$/i, "") + "_mapped.csv", { type: "text/csv" });
      // Capture the recommendations state immediately before writing.
      const before = await recommendationsApi.get();
      setRecsBefore(snapshotRecs(before.items));
      const res = await ioApi.importCsv(entity, mapped);
      return res;
    },
    onSuccess: async (res) => {
      setReport(res);
      setStep("result");
      void historyQ.refetch();
      // Make every cached view (dashboard, inventory, suppliers, analytics)
      // reflect the new data, then diff the live recommendations against the
      // pre-import snapshot.
      await qc.invalidateQueries();
      try {
        const after = await recommendationsApi.get();
        const snapAfter = snapshotRecs(after.items);
        const before = recsBefore;
        if (before) {
          const newAlerts: Recommendation[] = [];
          const changedAlerts: RecDelta["changedAlerts"] = [];
          const resolvedAlerts: Recommendation[] = [];
          for (const [sku, afterRec] of snapAfter.bySku) {
            const beforeRec = before.bySku.get(sku);
            if (!beforeRec) newAlerts.push(afterRec);
            else if (beforeRec.action !== afterRec.action || beforeRec.severity !== afterRec.severity) {
              changedAlerts.push({ sku, product: afterRec.product, before: beforeRec, after: afterRec });
            }
          }
          for (const [sku, beforeRec] of before.bySku) {
            if (!snapAfter.bySku.has(sku)) resolvedAlerts.push(beforeRec);
          }
          setRecsDelta({
            countsBefore: before.counts,
            countsAfter: snapAfter.counts,
            newAlerts: newAlerts.sort((a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1)),
            changedAlerts,
            resolvedAlerts,
          });
        }
      } catch {
        /* delta panel is best-effort; the import result still shows */
      }
      if (res.failed > 0) push("info", `Imported ${res.imported} of ${res.total} rows — ${res.failed} failed`);
      else push("success", `Imported ${res.imported} rows successfully`);
    },
    onError: (e) => push("error", e instanceof Error ? e.message : "Import failed"),
  });

  const startImport = () => {
    if (!data || !validation) return;
    if (validation.missingRequired.length > 0) {
      push("error", `Map the required columns first: ${validation.missingRequired.join(", ")}`);
      setStep("map");
      return;
    }
    if (validation.errorRows.length > 0) {
      importMutation.mutate(buildMappedCsv(entity, data, mapping, validation.validRows));
    } else {
      importMutation.mutate(buildMappedCsv(entity, data, mapping));
    }
  };

  return (
    <div>
      <PageHeader
        title="Import data"
        subtitle="Bring products, sales, inventory, or suppliers into the system from CSV or Excel."
        right={
          <Button variant="secondary" size="sm" onClick={() => downloadTemplate(entity)}>
            <Download className="h-3.5 w-3.5" /> Download template
          </Button>
        }
      />

      {/* Entity picker */}
      <div className="mb-5 flex flex-wrap gap-2">
        {Object.entries(ENTITY_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => switchEntity(key)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              entity === key ? "bg-chrome text-white shadow-sm" : "bg-surface text-ink/60 hover:text-ink"
            }`}
          >
            {meta.label}
          </button>
        ))}
      </div>
      <p className="mb-5 -mt-3 text-xs leading-relaxed text-ink/50">{ENTITY_META[entity].blurb}</p>

      {/* Step indicator */}
      <ol className="mb-5 flex items-center gap-2 text-xs" aria-label="Import progress">
        {STEPS.map((s, i) => {
          const activeIdx = STEPS.findIndex((x) => x.id === step);
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
          return (
            <li key={s.id} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                state === "done" ? "bg-lime-300 text-chrome" : state === "active" ? "bg-chrome text-white" : "bg-ink/10 text-ink/40"
              }`}>
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className={state === "active" ? "font-semibold text-ink" : "text-ink/40"}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-ink/15" aria-hidden />}
            </li>
          );
        })}
      </ol>

      {/* ------------------------------- UPLOAD ------------------------------ */}
      {step === "upload" && (
        <Card>
          <CardBody>
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload CSV file"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) acceptFile(f);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
                dragging ? "border-brand-500 bg-brand-500/5" : "border-ink/15 hover:border-ink/30 hover:bg-ink/[0.03]"
              }`}
            >
              <span className={`flex h-14 w-14 items-center justify-center rounded-full ${dragging ? "bg-brand-500/15 text-brand-600" : "bg-lime-300/25 text-ink/60"}`}>
                <UploadCloud className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">
                  {dragging ? "Drop to upload" : <>Drag & drop your CSV or Excel file here, or <span className="text-brand-600">browse</span></>}
                </p>
                <p className="mt-1 text-xs text-ink/40">.csv, .xlsx, .xls · header row required · quotes and multi-sheet workbooks supported</p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_IMPORT_TYPES}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); }}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink/50">
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Expected columns: {ENTITY_SPECS[entity].filter((s) => s.required).map((s) => s.key).join(", ")} + optional
              </span>
              <button className="font-semibold text-brand-600 hover:text-brand-700" onClick={() => downloadTemplate(entity)}>
                Download a sample template
              </button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* -------------------------------- MAP -------------------------------- */}
      {step === "map" && data && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Map columns"
              subtitle={`${file?.name} · ${data.rows.length.toLocaleString("en-IN")} data rows detected`}
              icon={<FileUp className="h-4 w-4" />}
              right={
                <Button variant="ghost" size="sm" onClick={reset}><X className="h-3.5 w-3.5" /> Start over</Button>
              }
            />
            <CardBody className="space-y-2">
              {ENTITY_SPECS[entity].map((spec) => {
                const chosen = mapping[spec.key] ?? null;
                return (
                  <div key={spec.key} className="flex flex-wrap items-center gap-2 rounded-2xl bg-panel px-3 py-2.5">
                    <div className="min-w-40 flex-1">
                      <p className="text-xs font-semibold text-ink">
                        {spec.label}
                        {spec.required && <span className="ml-1 text-red-500">*</span>}
                      </p>
                      <p className="text-[10px] text-ink/40">expects: {spec.kind === "date" ? "YYYY-MM-DD" : spec.kind}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink/25" />
                    <select
                      value={chosen ?? ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [spec.key]: e.target.value || null }))}
                      aria-label={`Map column for ${spec.label}`}
                      className="w-full max-w-56 rounded-full border border-ink/10 bg-surface px-3 py-1.5 text-xs text-ink focus:border-brand-500 focus:outline-none"
                    >
                      <option value="">— Not mapped —</option>
                      {data.headers.map((h) => (
                        <option key={h} value={h} disabled={Object.entries(mapping).some(([k, v]) => k !== spec.key && v === h)}>
                          {h}
                        </option>
                      ))}
                    </select>
                    {chosen ? (
                      <Badge tone="green">Mapped</Badge>
                    ) : spec.required ? (
                      <Badge tone="red">Required</Badge>
                    ) : (
                      <Badge tone="gray">Optional</Badge>
                    )}
                  </div>
                );
              })}
              {validation && validation.duplicateColumns.length > 0 && (
                <p className="flex items-center gap-1.5 rounded-2xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Column {validation.duplicateColumns.join(", ")} is mapped to multiple fields — each column can map once.
                </p>
              )}
            </CardBody>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="secondary" size="sm" onClick={() => setStep("upload")}>Back</Button>
            <Button
              size="sm"
              disabled={!validation || validation.missingRequired.length > 0 || validation.duplicateColumns.length > 0}
              onClick={() => setStep("review")}
            >
              Review rows <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------- REVIEW ------------------------------ */}
      {step === "review" && data && validation && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Row-level validation"
              subtitle="Checked with the same rules the server applies — errors won't be sent."
              icon={<CheckCircle2 className="h-4 w-4" />}
              right={
                <div className="flex gap-2">
                  <Badge tone="green">{validation.validRows.length} valid</Badge>
                  {validation.warnRows.length > 0 && <Badge tone="yellow">{validation.warnRows.length} warnings</Badge>}
                  {validation.errorRows.length > 0 && <Badge tone="red">{validation.errorRows.length} errors</Badge>}
                </div>
              }
            />
            <CardBody className="p-0">
              <div className="scrollbar-thin max-h-96 overflow-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-ink/10 text-[10px] uppercase tracking-wide text-ink/40">
                      <th className="px-4 py-2.5 font-medium">Row</th>
                      {ENTITY_SPECS[entity].filter((s) => mapping[s.key]).map((s) => (
                        <th key={s.key} className="whitespace-nowrap px-4 py-2.5 font-medium">{s.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 200).map((row, idx) => {
                      const rowError = validation.errorRows.includes(idx);
                      const rowWarn = validation.warnRows.includes(idx);
                      return (
                        <tr key={idx} className={`border-b border-ink/5 last:border-0 ${rowError ? "bg-red-500/[0.04]" : rowWarn ? "bg-amber-500/[0.04]" : ""}`}>
                          <td className="whitespace-nowrap px-4 py-2 align-top">
                            <span className={`inline-flex h-4.5 w-4.5 items-center justify-center rounded-full text-[9px] font-bold ${
                              rowError ? "bg-red-500/15 text-red-600" : rowWarn ? "bg-amber-500/15 text-amber-600" : "bg-emerald-500/15 text-emerald-600"
                            }`}>
                              {rowError ? "!" : rowWarn ? "?" : "✓"}
                            </span>
                            <span className="ml-1.5 text-ink/40">{idx + 2}</span>
                          </td>
                          {ENTITY_SPECS[entity].filter((s) => mapping[s.key]).map((s) => {
                            const ci = data.headers.indexOf(mapping[s.key]!);
                            const issue = validation.cells[`${idx}:${s.key}`];
                            return (
                              <td key={s.key} className="px-4 py-2 align-top">
                                <span className="text-ink/80">{row[ci] || <span className="text-ink/25">—</span>}</span>
                                {issue && (
                                  <span className={`mt-0.5 block text-[10px] leading-snug ${issue.severity === "error" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                                    {issue.message}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data.rows.length > 200 && (
                <p className="px-4 py-2 text-[10px] text-ink/35">
                  Showing the first 200 of {data.rows.length.toLocaleString("en-IN")} rows — all rows are still validated and imported.
                </p>
              )}
            </CardBody>
          </Card>

          {validation.errorRows.length > 0 && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-ink/50">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              {validation.errorRows.length} row{validation.errorRows.length === 1 ? "" : "s"} with errors will be skipped; the {validation.validRows.length} valid row{validation.validRows.length === 1 ? "" : "s"} will import.
            </p>
          )}

          {/* ---------------- Change impact (server dry-run) ---------------- */}
          {preview && preview.mode === "upsert" && (
            <Card>
              <CardHeader
                title="Change impact"
                subtitle="Server-side dry-run against the current database."
                icon={preview.updates > 0 ? <ShieldAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                right={
                  <div className="flex gap-2">
                    <Badge tone="green">{preview.creates} new</Badge>
                    {preview.updates > 0 && <Badge tone="yellow">{preview.updates} to update</Badge>}
                  </div>
                }
              />
              <CardBody className="space-y-3">
                {preview.updates > 0 ? (
                  <>
                    <p className="flex items-start gap-2 rounded-2xl bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <strong>{preview.updates} existing {entity === "products" ? "product" : "supplier"}{preview.updates === 1 ? "" : "s"}</strong>
                        {" "}{preview.updates === 1 ? "will be" : "will be"} overwritten with the values below. This cannot be undone.
                      </span>
                    </p>
                    <div className="scrollbar-thin max-h-64 overflow-auto rounded-2xl bg-panel p-3">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-ink/40">
                            <th className="py-1.5 pr-3 font-medium">Row</th>
                            <th className="py-1.5 pr-3 font-medium">{entity === "products" ? "SKU" : "Supplier"}</th>
                            <th className="py-1.5 pr-3 font-medium">Field</th>
                            <th className="py-1.5 pr-3 font-medium">Current</th>
                            <th className="py-1.5 font-medium">New</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.changes.map((c) =>
                            c.fields.map((f, fi) => {
                              const label = ENTITY_SPECS[entity]?.find((s) => s.key === f.field)?.label ?? f.field;
                              return (
                                <tr key={`${c.row}-${f.field}`} className="border-t border-ink/5">
                                  <td className="py-1.5 pr-3 text-ink/40">{c.row}</td>
                                  {fi === 0 ? (
                                    <td className="py-1.5 pr-3 font-semibold text-ink" rowSpan={c.fields.length}>{c.key}</td>
                                  ) : null}
                                  <td className="py-1.5 pr-3 text-ink/70">{label}</td>
                                  <td className="py-1.5 pr-3 text-red-600 line-through decoration-red-400/60 dark:text-red-400">{String(f.old ?? "—")}</td>
                                  <td className="py-1.5 font-semibold text-emerald-600 dark:text-emerald-400">{String(f.new ?? "—")}</td>
                                </tr>
                              );
                            }),
                          )}
                        </tbody>
                      </table>
                    </div>
                    {preview.changes_truncated > 0 && (
                      <p className="text-[10px] text-ink/35">Showing the first 20 of {preview.updates} updates.</p>
                    )}
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-ink">
                      <input
                        type="checkbox"
                        checked={confirmOverwrite}
                        onChange={(e) => setConfirmOverwrite(e.target.checked)}
                        className="h-4 w-4 accent-amber-600"
                      />
                      I understand {preview.updates} existing {preview.updates === 1 ? "record" : "records"} will be modified — proceed
                    </label>
                  </>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> All rows are new — nothing will be overwritten.
                  </p>
                )}
                {preview.invalid_count > 0 && (
                  <p className="text-xs text-ink/50">
                    The server also flagged {preview.invalid_count} row{preview.invalid_count === 1 ? "" : "s"} it would reject — matching the client checks above.
                  </p>
                )}
              </CardBody>
            </Card>
          )}
          {preview && preview.mode === "append" && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-ink/50">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Append mode: rows are added to history — existing data is never modified.
            </p>
          )}
          {previewQ.isError && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Could not run the server dry-run ({(previewQ.error as Error)?.message}). You can still import — server-side validation will apply.
            </p>
          )}

          <div className="flex items-center justify-between">
            <Button variant="secondary" size="sm" onClick={() => setStep("map")}>Back to mapping</Button>
            <Button
              size="sm"
              onClick={startImport}
              disabled={validation.validRows.length === 0 || (needsConfirm && !confirmOverwrite)}
              loading={importMutation.isPending}
              title={needsConfirm && !confirmOverwrite ? "Confirm the overwrite notice first" : undefined}
            >
              Import {validation.validRows.length} row{validation.validRows.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------- RESULT ------------------------------ */}
      {step === "result" && report && (
        <Card>
          <CardHeader
            title="Import report"
            subtitle={file?.name}
            icon={report.failed > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-emerald-500/10 px-4 py-3">
                <p className="font-display text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{report.imported}</p>
                <p className="text-xs text-ink/50">rows imported</p>
              </div>
              <div className="rounded-2xl bg-red-500/10 px-4 py-3">
                <p className="font-display text-2xl font-semibold text-red-600 dark:text-red-400">{report.failed}</p>
                <p className="text-xs text-ink/50">rows failed</p>
              </div>
              <div className="rounded-2xl bg-ink/5 px-4 py-3">
                <p className="font-display text-2xl font-semibold text-ink">{report.total}</p>
                <p className="text-xs text-ink/50">total processed</p>
              </div>
            </div>

            {/* ------------------ Live recommendation impact ------------------ */}
            {recsDelta && (
              <div className="rounded-3xl bg-chrome p-5 shadow-float">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 font-display text-sm font-semibold text-white">
                    <Sparkles className="h-4 w-4 text-lime-300" />
                    What changed in your recommendations
                  </p>
                  <div className="flex gap-2 text-[10px] font-bold uppercase tracking-wider">
                    {(Object.keys(recsDelta.countsAfter) as (keyof RecsSnapshot["counts"])[]).map((k) => (
                      <span key={k} className="text-white/40">
                        {k}: <span className="text-white">{recsDelta.countsBefore[k]}</span>
                        <span className="mx-0.5 text-white/30">→</span>
                        <span className={
                          recsDelta.countsAfter[k] > recsDelta.countsBefore[k] ? "text-lime-300" :
                          recsDelta.countsAfter[k] < recsDelta.countsBefore[k] ? "text-red-400" : "text-white/60"
                        }>
                          {recsDelta.countsAfter[k]}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>

                {recsDelta.newAlerts.length === 0 && recsDelta.changedAlerts.length === 0 && recsDelta.resolvedAlerts.length === 0 ? (
                  <p className="mt-3 text-xs text-white/50">No alert changes — the imported records are healthy or have no demand history yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {recsDelta.newAlerts.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-lime-300">
                          {recsDelta.newAlerts.length} new alert{recsDelta.newAlerts.length === 1 ? "" : "s"}
                        </p>
                        <div className="space-y-1.5">
                          {recsDelta.newAlerts.slice(0, 5).map((r) => (
                            <button
                              key={r.sku}
                              onClick={() => window.location.assign(`/products/${r.product_id}`)}
                              className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-white/5 px-3 py-2 text-left text-xs text-white/80 transition-colors hover:bg-white/10"
                            >
                              <Badge tone={r.severity === "critical" ? "red" : "yellow"}>{r.action}</Badge>
                              <span className="font-semibold text-white">{r.product}</span>
                              <span className="text-white/40">{r.sku}</span>
                              <span className="ml-auto text-white/50">{r.reason.slice(0, 70)}{r.reason.length > 70 ? "…" : ""}</span>
                              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-lime-300" />
                            </button>
                          ))}
                          {recsDelta.newAlerts.length > 5 && (
                            <button onClick={() => window.location.assign("/insights")} className="pl-1 text-xs font-semibold text-lime-300 hover:underline">
                              View all {recsDelta.newAlerts.length} in Recommendations →
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {recsDelta.changedAlerts.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                          {recsDelta.changedAlerts.length} alert{recsDelta.changedAlerts.length === 1 ? "" : "s"} changed urgency
                        </p>
                        <div className="space-y-1.5">
                          {recsDelta.changedAlerts.slice(0, 5).map(({ sku, product, before, after }) => (
                            <button
                              key={sku}
                              onClick={() => window.location.assign(`/products/${after.product_id}`)}
                              className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-white/5 px-3 py-2 text-left text-xs text-white/80 transition-colors hover:bg-white/10"
                            >
                              <Badge tone="gray">{before.action}</Badge>
                              <ArrowRight className="h-3 w-3 shrink-0 text-white/40" />
                              <Badge tone={after.severity === "critical" ? "red" : "yellow"}>{after.action}</Badge>
                              <span className="font-semibold text-white">{product}</span>
                              <span className="text-white/40">{sku}</span>
                              <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-300" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {recsDelta.resolvedAlerts.length > 0 && (
                      <p className="text-xs text-white/50">
                        {recsDelta.resolvedAlerts.length} previous alert{recsDelta.resolvedAlerts.length === 1 ? "" : "s"} no longer fire
                        {recsDelta.resolvedAlerts.some((r) => r.action === "NO ACTION") ? " (e.g. resolved stock issues)" : ""}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {!recsDelta && (
              <p className="text-xs text-ink/40">Comparing live recommendations against the pre-import snapshot…</p>
            )}

            {report.errors.length > 0 ? (
              <div className="rounded-2xl bg-panel p-3">
                <p className="mb-2 text-xs font-semibold text-ink">Row errors from the server</p>
                <ul className="scrollbar-thin max-h-56 space-y-1.5 overflow-auto text-xs">
                  {report.errors.map((e, i) => (
                    <li key={i} className="flex items-start gap-2 text-ink/70">
                      <Badge tone="red">Row {e.row}</Badge>
                      <span>{e.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Every row imported cleanly.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={reset}><RefreshCw className="h-3.5 w-3.5" /> Import another file</Button>
              <Button variant="lime" size="sm" onClick={() => window.location.assign("/inventory")}>
                View {entity === "products" ? "products" : "the data"} in Inventory
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {productsQ.isError || suppliersQ.isError ? (
        <Card className="mt-4">
          <ErrorState
            message="Could not load reference data for validation."
            onRetry={() => { productsQ.refetch(); suppliersQ.refetch(); }}
          />
        </Card>
      ) : null}

      {data && data.rows.length === 0 && (
        <Card className="mt-4"><EmptyState title="No rows found" message="The file has headers but no data rows." /></Card>
      )}

      {/* ----------------------------- Import history ----------------------------- */}
      <Card className="mt-6">
        <CardHeader
          title="Import history"
          subtitle="Past imports with results and the original files for re-download."
          icon={<Clock className="h-4 w-4" />}
          right={
            <Button variant="ghost" size="sm" onClick={() => historyQ.refetch()} loading={historyQ.isFetching}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          }
        />
        <CardBody className="p-0">
          {historyQ.isLoading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : historyQ.isError ? (
            <ErrorState message="Could not load import history." onRetry={() => historyQ.refetch()} />
          ) : (historyQ.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title="No imports yet"
              message="Your first import will appear here with its results and the original file."
            />
          ) : (
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-ink/10 text-[10px] uppercase tracking-wide text-ink/40">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">File</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Result</th>
                    <th className="px-4 py-2.5 font-medium">Run by</th>
                    <th className="px-4 py-2.5 font-medium text-right">File</th>
                  </tr>
                </thead>
                <tbody>
                  {historyQ.data!.items.map((h) => (
                    <tr key={h.id} className="border-b border-ink/5 last:border-0">
                      <td className="whitespace-nowrap px-5 py-2.5 text-ink/60" title={h.ran_at ?? undefined}>
                        {h.ran_at ? new Date(h.ran_at + (h.ran_at.endsWith("Z") ? "" : "Z")).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="max-w-52 truncate px-4 py-2.5 font-medium text-ink" title={h.filename}>{h.filename}</td>
                      <td className="px-4 py-2.5"><Badge tone="gray">{h.entity}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{h.imported}</span>
                        <span className="text-ink/40"> ok</span>
                        {h.failed > 0 && <>
                          <span className="mx-1 text-ink/20">·</span>
                          <span className="font-semibold text-red-600 dark:text-red-400">{h.failed}</span>
                          <span className="text-ink/40"> failed</span>
                        </>}
                      </td>
                      <td className="px-4 py-2.5 text-ink/60">
                        {h.uploaded_by_name || h.uploaded_by}
                        {h.uploaded_by_name && <span className="ml-1 text-ink/30">({h.uploaded_by})</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        {h.file_available ? (
                          <button
                            onClick={() => downloadImportFile(h.id, h.filename).catch((e) => push("error", e instanceof Error ? e.message : "Download failed"))}
                            className="inline-flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-[11px] font-semibold text-brand-600 ring-1 ring-ink/10 transition-colors hover:ring-brand-400"
                            title={`Re-download ${h.filename} (${(h.file_size / 1024).toFixed(1)} KB)`}
                          >
                            <Download className="h-3 w-3" /> Re-download
                          </button>
                        ) : (
                          <span className="text-[11px] text-ink/30" title="Files over 5 MB are not stored">Too large to store</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
