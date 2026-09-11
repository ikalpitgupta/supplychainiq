import { describe, expect, it } from "vitest";

import {
  formatDelta,
  formatDays,
  formatINR,
  formatMonth,
  formatNumber,
  formatPct,
} from "./format";

describe("formatINR", () => {
  it("renders em-dash for null/undefined/NaN", () => {
    expect(formatINR(null)).toBe("—");
    expect(formatINR(undefined)).toBe("—");
    expect(formatINR(NaN)).toBe("—");
  });

  it("uses crore for values >= 1 Cr", () => {
    expect(formatINR(124_000_000)).toBe("₹12.40 Cr");
  });

  it("uses lakh for values >= 1 L", () => {
    expect(formatINR(2_500_000)).toBe("₹25.00 L");
  });

  it("uses thousands below a lakh", () => {
    expect(formatINR(5_400)).toBe("₹5.4K");
  });

  it("formats plain amounts in non-compact mode", () => {
    expect(formatINR(1234, false)).toBe("₹1,234");
  });
});

describe("formatNumber / formatPct", () => {
  it("handles nulls", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatPct(undefined)).toBe("—");
  });

  it("formats percentages with configured digits", () => {
    expect(formatPct(8.44)).toBe("8.4%");
    expect(formatPct(8.44, 2)).toBe("8.44%");
  });
});

describe("formatDays", () => {
  it("explains zero-demand products instead of dividing by zero", () => {
    expect(formatDays(null)).toBe("No recent demand");
    expect(formatDays(undefined)).toBe("No recent demand");
  });

  it("shows one decimal under 10 days", () => {
    expect(formatDays(6.24)).toBe("6.2 days");
  });

  it("rounds to whole days from 10 up", () => {
    expect(formatDays(45.6)).toBe("46 days");
  });
});

describe("formatDelta", () => {
  it("is flat for null", () => {
    expect(formatDelta(null)).toEqual({ text: "—", dir: "flat" });
  });

  it("classifies direction with a small dead-band", () => {
    expect(formatDelta(8.4).dir).toBe("up");
    expect(formatDelta(-3.1).dir).toBe("down");
    expect(formatDelta(0.03).dir).toBe("flat");
  });

  it("always reports magnitude, not sign", () => {
    expect(formatDelta(-12.34).text).toBe("12.3%");
  });
});

describe("formatMonth", () => {
  it("renders YYYY-MM as Mon YY", () => {
    expect(formatMonth("2026-09")).toMatch(/Sep/i);
    expect(formatMonth("2026-09")).toContain("26");
  });
});
