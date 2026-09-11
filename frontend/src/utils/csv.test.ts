// Unit tests for the import engine: CSV parser, XLSX workbook parsing,
// auto-mapping, validation.
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  autoMap, buildMappedCsv, isSpreadsheetFile, parseCsv, parseSpreadsheet,
  validateDataset, ENTITY_SPECS,
} from "./csv";

describe("parseCsv", () => {
  it("parses simple rows and strips the header", () => {
    const p = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(p.headers).toEqual(["a", "b", "c"]);
    expect(p.rows).toEqual([["1", "2", "3"], ["4", "5", "6"]]);
  });

  it("handles quoted cells with commas", () => {
    const p = parseCsv('sku,name\nS1,"Sofa, Large"');
    expect(p.rows[0][1]).toBe("Sofa, Large");
  });

  it("handles escaped quotes inside quoted cells", () => {
    const p = parseCsv('name\n"He said ""hello"""');
    expect(p.rows[0][0]).toBe('He said "hello"');
  });

  it("handles CRLF line endings and a trailing BOM", () => {
    const p = parseCsv("\uFEFFa,b\r\n1,2\r\n");
    expect(p.headers).toEqual(["a", "b"]);
    expect(p.rows).toEqual([["1", "2"]]);
  });

  it("pads ragged rows to the header length", () => {
    const p = parseCsv("a,b,c\n1,2");
    expect(p.rows[0]).toEqual(["1", "2", ""]);
  });

  it("skips fully blank lines", () => {
    const p = parseCsv("a,b\n1,2\n\n\n3,4");
    expect(p.rows).toEqual([["1", "2"], ["3", "4"]]);
  });
});

describe("parseSpreadsheet (xlsx)", () => {
  function makeWorkbook(rows: string[][]): File {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Data");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    return new File([buf], "test.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  it("parses headers and rows from an xlsx workbook", async () => {
    const f = makeWorkbook([["sku", "name", "unit_cost"], ["S1", "Widget", "10"], ["S2", "Gadget", "20"]]);
    const p = await parseSpreadsheet(f);
    expect(p.headers).toEqual(["sku", "name", "unit_cost"]);
    expect(p.rows).toEqual([["S1", "Widget", "10"], ["S2", "Gadget", "20"]]);
  });

  it("skips leading sheets with no data and pads ragged rows", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[""]]), "Empty");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], ["1"]]), "Data");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const p = await parseSpreadsheet(new File([buf], "multi.xlsx"));
    expect(p.headers).toEqual(["a", "b"]);
    expect(p.rows).toEqual([["1", ""]]);
  });

  it("still parses CSV text through the same entry point", async () => {
    const p = await parseSpreadsheet("a,b\n1,2");
    expect(p.rows).toEqual([["1", "2"]]);
  });

  it("recognizes spreadsheet extensions", () => {
    const mk = (name: string) => new File(["x"], name);
    expect(isSpreadsheetFile(mk("a.csv"))).toBe(true);
    expect(isSpreadsheetFile(mk("b.XLSX"))).toBe(true);
    expect(isSpreadsheetFile(mk("c.xls"))).toBe(true);
    expect(isSpreadsheetFile(mk("d.json"))).toBe(false);
  });
});

describe("autoMap", () => {
  const specs = ENTITY_SPECS.products;

  it("maps by exact alias", () => {
    const m = autoMap(["sku", "name", "unit_cost"], specs);
    expect(m.sku).toBe("sku");
    expect(m.name).toBe("name");
    expect(m.unit_cost).toBe("unit_cost");
    expect(m.category).toBeNull();
  });

  it("maps messy headers case/punctuation-insensitively", () => {
    const m = autoMap(["SKU Code", "Product Name", "Cost Price (INR)"], specs);
    expect(m.sku).toBe("SKU Code");
    expect(m.name).toBe("Product Name");
    expect(m.unit_cost).toBe("Cost Price (INR)");
  });

  it("never assigns the same header twice", () => {
    // "code" is an alias of both sku; only one field may claim it.
    const m = autoMap(["code", "title"], specs);
    const used = Object.values(m).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("validateDataset", () => {
  const refs = { skus: ["SPO-001"], suppliers: ["Nexus Components"] };
  const specs = ENTITY_SPECS.sales;

  it("flags a missing required column", () => {
    const data = parseCsv("sku,quantity\nSPO-001,5");
    const m = autoMap(data.headers, specs);
    const v = validateDataset("sales", data, m, refs);
    expect(v.missingRequired).toContain("Sale date");
  });

  it("rejects bad dates, negatives, and unknown SKUs per row", () => {
    const data = parseCsv(
      "sku,sale_date,quantity\nSPO-001,2026-01-15,5\nSPO-001,15/01/2026,3\nSPO-001,2026-01-16,-2\nGHOST,2026-01-16,2",
    );
    const m = autoMap(data.headers, specs);
    const v = validateDataset("sales", data, m, refs);
    expect(v.validRows).toEqual([0]);
    expect(v.errorRows).toEqual([1, 2, 3]);
    expect(v.cells["1:sale_date"]?.message).toMatch(/YYYY-MM-DD/);
    expect(v.cells["2:quantity"]?.message).toMatch(/negative/);
    expect(v.cells["3:sku"]?.message).toMatch(/Unknown SKU/);
  });

  it("warns (not errors) on unknown product suppliers", () => {
    const data = parseCsv("sku,name,unit_cost,supplier\nS1,Widget,10,Mystery Vendor");
    const v = validateDataset("products", data, autoMap(data.headers, ENTITY_SPECS.products), refs);
    expect(v.errorRows).toEqual([]);
    expect(v.warnRows).toEqual([0]);
    expect(v.cells["0:supplier"]?.severity).toBe("warn");
  });

  it("accepts valid rate ranges only", () => {
    const ok = parseCsv("name,on_time_rate\nAcme,0.95\nBad,1.5");
    const v = validateDataset("suppliers", ok, autoMap(ok.headers, ENTITY_SPECS.suppliers), refs);
    expect(v.validRows).toEqual([0]);
    expect(v.errorRows).toEqual([1]);
  });
});

describe("buildMappedCsv", () => {
  it("emits canonical spec-key headers and only requested rows", () => {
    const data = parseCsv("SKU Code,Sale Date,Qty\nSPO-001,2026-01-15,5\nGHOST,2026-01-16,2");
    const m = { sku: "SKU Code", sale_date: "Sale Date", quantity: "Qty", revenue: null, region: null };
    const csv = buildMappedCsv("sales", data, m, [0]);
    const [header, row] = csv.split("\n");
    expect(header).toBe("sku,sale_date,quantity,revenue,region");
    expect(row).toBe("SPO-001,2026-01-15,5,,");
  });

  it("quotes cells that contain commas", () => {
    const data = parseCsv("Product Name\n\"Sofa, Large\"");
    const m = { sku: "Product Name", name: null, category: null, supplier: null, unit_cost: null, selling_price: null, lead_time_days: null };
    const csv = buildMappedCsv("products", data, m, [0]);
    // The full products spec row is emitted (7 columns); the name cell is quoted.
    expect(csv.split("\n")[1]).toBe('"Sofa, Large",,,,,,');
  });
});
