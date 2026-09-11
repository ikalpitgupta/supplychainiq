// Import engine: quote-aware CSV parsing plus XLSX workbook support, per-entity
// field specs, auto column mapping, client-side row validation mirroring the
// backend importers, and canonical mapped-CSV building for the upload.
import * as XLSX from "xlsx";
import type { ImportReport } from "../types";

/* ------------------------------- Templates ------------------------------- */
export const CSV_TEMPLATES: Record<string, string> = {
  products: "sku,name,category,supplier,unit_cost,selling_price,lead_time_days\nSPO-001,Widget Pro,Electronics,Nexus Components Pvt Ltd,499,699,10",
  sales: "sku,sale_date,quantity,revenue,region\nSPO-001,2026-09-01,12,8388,North",
  inventory: "sku,date,opening_stock,received_quantity,sold_quantity,closing_stock\nSPO-001,2026-09-01,100,0,12,88",
  suppliers: "name,lead_time_days,unit_cost,on_time_rate,defect_rate,reliability_score\nAcme Supplies,12,1.02,0.91,0.015,0.88",
};

export function downloadTemplate(entity: string): void {
  const text = CSV_TEMPLATES[entity];
  if (!text) return;
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${entity}_template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* --------------------------------- Parser -------------------------------- */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export const ACCEPTED_IMPORT_TYPES = ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

export function isSpreadsheetFile(f: File): boolean {
  return /\.(csv|txt|xlsx|xlsm|xls)$/i.test(f.name);
}

/**
 * Parses any supported spreadsheet file into the ParsedCsv grid.
 * CSV/TXT → text parser; XLSX/XLS/XLSM → first sheet with data via SheetJS,
 * with raw:false so Excel dates/numbers arrive as formatted strings.
 */
export function parseSpreadsheet(textOrFile: string | File): Promise<ParsedCsv> {
  if (typeof textOrFile === "string") return Promise.resolve(parseCsv(textOrFile));
  const file = textOrFile;
  if (/\.(csv|txt)$/i.test(file.name)) {
    return file.text().then(parseCsv);
  }
  return file.arrayBuffer().then((buf) => {
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const sheetName = wb.SheetNames.find((n) => {
      const ref = wb.Sheets[n]?.["!ref"];
      return !!ref && ref !== "A1";
    }) ?? wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error("The workbook has no readable sheets");
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    const cleaned = grid.map((row) => (row as unknown[]).map((c) => String(c ?? "").trim()));
    const meaningful = cleaned.filter((r) => r.some((c) => c !== ""));
    const headers = (meaningful.shift() ?? []).map((h) => h.trim());
    const rows = meaningful.map((r) => {
      const cells = r.slice(0, headers.length);
      while (cells.length < headers.length) cells.push("");
      return cells;
    });
    if (headers.length === 0 || rows.length === 0) throw new Error("That sheet has no readable rows");
    return { headers, rows };
  });
}

/** RFC-4180-ish CSV parser: quoted cells, escaped quotes, CRLF, BOM, ragged rows. */
export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const meaningful = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (meaningful.shift() ?? []).map((h) => h.trim());
  const normalized = meaningful.map((r) => {
    const cells = r.map((c) => c.trim());
    while (cells.length < headers.length) cells.push("");
    return cells.slice(0, headers.length);
  });
  return { headers, rows: normalized };
}

/* ------------------------------ Field specs ------------------------------ */
export type FieldKind = "text" | "number" | "positive" | "nonNegativeInt" | "rate" | "date";
export type RefKind = "skus" | "suppliers";

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  kind: FieldKind;
  aliases: string[];
  /** Reference-list validation: sales/inventory skus must exist; product suppliers warn if unknown. */
  ref?: RefKind;
  refSeverity?: "error" | "warn";
}

export const ENTITY_SPECS: Record<string, FieldSpec[]> = {
  products: [
    { key: "sku", label: "SKU", required: true, kind: "text", aliases: ["sku", "code", "product_code", "item_code"] },
    { key: "name", label: "Product name", required: true, kind: "text", aliases: ["name", "product", "product_name", "title"] },
    { key: "category", label: "Category", required: false, kind: "text", aliases: ["category", "cat", "type", "segment"] },
    { key: "supplier", label: "Supplier", required: false, kind: "text", aliases: ["supplier", "supplier_name", "vendor"], ref: "suppliers", refSeverity: "warn" },
    { key: "unit_cost", label: "Unit cost", required: true, kind: "positive", aliases: ["unit_cost", "cost", "purchase_price", "cost_price"] },
    { key: "selling_price", label: "Selling price", required: false, kind: "number", aliases: ["selling_price", "price", "mrp", "list_price"] },
    { key: "lead_time_days", label: "Lead time (days)", required: false, kind: "nonNegativeInt", aliases: ["lead_time_days", "lead_time", "leadtime"] },
  ],
  sales: [
    { key: "sku", label: "SKU", required: true, kind: "text", aliases: ["sku", "code", "product_code"], ref: "skus", refSeverity: "error" },
    { key: "sale_date", label: "Sale date", required: true, kind: "date", aliases: ["sale_date", "date", "sold_on", "order_date"] },
    { key: "quantity", label: "Quantity", required: true, kind: "nonNegativeInt", aliases: ["quantity", "qty", "units", "units_sold"] },
    { key: "revenue", label: "Revenue", required: false, kind: "number", aliases: ["revenue", "amount", "total", "sales"] },
    { key: "region", label: "Region", required: false, kind: "text", aliases: ["region", "zone", "area"] },
  ],
  inventory: [
    { key: "sku", label: "SKU", required: true, kind: "text", aliases: ["sku", "code", "product_code"], ref: "skus", refSeverity: "error" },
    { key: "date", label: "Date", required: true, kind: "date", aliases: ["date", "snapshot_date", "day"] },
    { key: "opening_stock", label: "Opening stock", required: false, kind: "nonNegativeInt", aliases: ["opening_stock", "opening", "start_stock"] },
    { key: "received_quantity", label: "Received", required: false, kind: "nonNegativeInt", aliases: ["received_quantity", "received", "incoming"] },
    { key: "sold_quantity", label: "Sold", required: false, kind: "nonNegativeInt", aliases: ["sold_quantity", "sold", "outgoing"] },
    { key: "closing_stock", label: "Closing stock", required: false, kind: "nonNegativeInt", aliases: ["closing_stock", "closing", "end_stock"] },
  ],
  suppliers: [
    { key: "name", label: "Supplier name", required: true, kind: "text", aliases: ["name", "supplier", "supplier_name", "vendor"] },
    { key: "lead_time_days", label: "Lead time (days)", required: false, kind: "nonNegativeInt", aliases: ["lead_time_days", "lead_time", "leadtime"] },
    { key: "unit_cost", label: "Cost index", required: false, kind: "number", aliases: ["unit_cost", "cost", "cost_index"] },
    { key: "on_time_rate", label: "On-time rate (0–1)", required: false, kind: "rate", aliases: ["on_time_rate", "ontime", "on_time"] },
    { key: "defect_rate", label: "Defect rate (0–1)", required: false, kind: "rate", aliases: ["defect_rate", "defects", "defect"] },
    { key: "reliability_score", label: "Reliability (0–1)", required: false, kind: "rate", aliases: ["reliability_score", "reliability"] },
  ],
};

export const ENTITY_META: Record<string, { label: string; blurb: string }> = {
  products: {
    label: "Products",
    blurb: "Creates or updates products by SKU. Unknown categories are created automatically; unknown suppliers are linked only if the name matches.",
  },
  sales: {
    label: "Sales",
    blurb: "Appends sales transactions. Every SKU must already exist — import products first. Revenue defaults to quantity × selling price when omitted.",
  },
  inventory: {
    label: "Inventory",
    blurb: "Appends daily stock snapshots. Closing stock is computed as opening + received − sold when omitted.",
  },
  suppliers: {
    label: "Suppliers",
    blurb: "Creates or updates suppliers by name. Rates are 0–1 (0.95 = 95%).",
  },
};

/* ------------------------------ Column mapping --------------------------- */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Maps each field spec to a file header (or null). Exact alias match first, then containment. */
export function autoMap(headers: string[], specs: FieldSpec[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();
  const normHeaders = headers.map(norm);

  // Pass 1: exact alias equality
  for (const spec of specs) {
    const hit = headers.find((h, i) => !used.has(h) && spec.aliases.some((a) => normHeaders[i] === norm(a)));
    if (hit) { mapping[spec.key] = hit; used.add(hit); }
  }
  // Pass 2: containment (header contains alias or vice versa)
  for (const spec of specs) {
    if (mapping[spec.key]) continue;
    const hit = headers.find((h, i) => !used.has(h) && spec.aliases.some((a) => {
      const na = norm(a);
      return na.length > 2 && (normHeaders[i].includes(na) || na.includes(normHeaders[i]));
    }));
    if (hit) { mapping[spec.key] = hit; used.add(hit); }
  }
  for (const spec of specs) if (!mapping[spec.key]) mapping[spec.key] = null;
  return mapping;
}

/* ------------------------------- Validation ------------------------------ */
export type IssueSeverity = "error" | "warn";
export interface CellIssue { severity: IssueSeverity; message: string; }

export interface ValidationResult {
  /** Per-row, per-field issues: key is `${rowIndex}:${fieldKey}`. */
  cells: Record<string, CellIssue>;
  /** Row indexes with zero error-severity issues. */
  validRows: number[];
  errorRows: number[];
  warnRows: number[];
  /** Fields that are required but have no column mapped — blocks import entirely. */
  missingRequired: string[];
  /** Same file column assigned to multiple fields. */
  duplicateColumns: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkCell(spec: FieldSpec, raw: string, ref: { skus: Set<string>; suppliers: Set<string> }): CellIssue | null {
  const v = raw.trim();
  if (v === "") {
    return spec.required ? { severity: "error", message: `${spec.label} is required` } : null;
  }
  switch (spec.kind) {
    case "positive": {
      const n = Number(v);
      if (!Number.isFinite(n)) return { severity: "error", message: `${spec.label} must be a number` };
      if (n <= 0) return { severity: "error", message: `${spec.label} must be greater than 0` };
      return null;
    }
    case "number": {
      if (!Number.isFinite(Number(v))) return { severity: "error", message: `${spec.label} must be a number` };
      return null;
    }
    case "nonNegativeInt": {
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { severity: "error", message: `${spec.label} must be a whole number` };
      if (n < 0) return { severity: "error", message: `${spec.label} cannot be negative` };
      return null;
    }
    case "rate": {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) return { severity: "error", message: `${spec.label} must be between 0 and 1` };
      return null;
    }
    case "date": {
      if (!ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) {
        return { severity: "error", message: "Use the YYYY-MM-DD date format" };
      }
      return null;
    }
    case "text": {
      if (spec.ref === "skus" && ref.skus.size > 0 && !ref.skus.has(v.toLowerCase())) {
        return { severity: "error", message: `Unknown SKU "${v}" — import products first` };
      }
      if (spec.ref === "suppliers" && ref.suppliers.size > 0 && !ref.suppliers.has(v.toLowerCase())) {
        return { severity: "warn", message: `Supplier "${v}" is not in the system — will be left unlinked` };
      }
      return null;
    }
  }
}

export function validateDataset(
  entity: string,
  data: ParsedCsv,
  mapping: Record<string, string | null>,
  ref: { skus: string[]; suppliers: string[] },
): ValidationResult {
  const specs = ENTITY_SPECS[entity] ?? [];
  const colIndex: Record<string, number> = {};
  for (const spec of specs) {
    const header = mapping[spec.key];
    colIndex[spec.key] = header ? data.headers.indexOf(header) : -1;
  }

  const missingRequired = specs.filter((s) => s.required && colIndex[s.key] === -1).map((s) => s.label);

  const counts: Record<string, number> = {};
  for (const header of Object.values(mapping)) {
    if (!header) continue;
    counts[header] = (counts[header] ?? 0) + 1;
  }
  const duplicateColumns = Object.entries(mapping)
    .filter(([, h]) => h && counts[h] > 1)
    .map(([, h]) => h as string);

  const refSets = {
    skus: new Set(ref.skus.map((s) => s.toLowerCase())),
    suppliers: new Set(ref.suppliers.map((s) => s.toLowerCase())),
  };

  const cells: Record<string, CellIssue> = {};
  const validRows: number[] = [];
  const errorRows: number[] = [];
  const warnRows: number[] = [];

  data.rows.forEach((row, idx) => {
    let hasError = false;
    let hasWarn = false;
    for (const spec of specs) {
      const ci = colIndex[spec.key];
      if (ci === -1) {
        if (spec.required) {
          cells[`${idx}:${spec.key}`] = { severity: "error", message: `${spec.label} column is not mapped` };
          hasError = true;
        }
        continue;
      }
      const issue = checkCell(spec, row[ci] ?? "", refSets);
      if (issue) {
        cells[`${idx}:${spec.key}`] = issue;
        if (issue.severity === "error") hasError = true;
        else hasWarn = true;
      }
    }
    if (hasError) errorRows.push(idx);
    else {
      validRows.push(idx);
      if (hasWarn) warnRows.push(idx);
    }
  });

  return { cells, validRows, errorRows, warnRows, missingRequired, duplicateColumns };
}

/* ---------------------------- Mapped CSV build --------------------------- */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Builds the canonical CSV (spec-key headers, spec order) that the backend expects. */
export function buildMappedCsv(
  entity: string,
  data: ParsedCsv,
  mapping: Record<string, string | null>,
  onlyRowIndexes?: number[],
): string {
  const specs = ENTITY_SPECS[entity] ?? [];
  const colIndex: Record<string, number> = {};
  for (const spec of specs) {
    const header = mapping[spec.key];
    colIndex[spec.key] = header ? data.headers.indexOf(header) : -1;
  }
  const rows = onlyRowIndexes ?? data.rows.map((_, i) => i);
  const lines = [specs.map((s) => s.key).join(",")];
  for (const idx of rows) {
    const row = data.rows[idx];
    lines.push(specs.map((s) => csvCell(colIndex[s.key] === -1 ? "" : (row[colIndex[s.key]] ?? ""))).join(","));
  }
  return lines.join("\n");
}

export type { ImportReport };
