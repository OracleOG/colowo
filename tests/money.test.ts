import { describe, expect, it } from "vitest";
import { parseAmountToKobo } from "@/lib/money";
import { normalizeEmployeeNo, normalizePhone } from "@/lib/normalize";

describe("parseAmountToKobo", () => {
  it.each([
    [5000, 500000],
    [1234.56, 123456],
    [0.1 + 0.2, 30], // float noise from Excel is rounded, not truncated
    ["1,234.50", 123450],
    ["₦25,000", 2500000],
    ["NGN 1 500.5", 150050],
    ["  7000.00 ", 700000],
    ["(500.00)", -50000],
    ["-20", -2000],
  ])("parses %j as %i kobo", (raw, kobo) => {
    expect(parseAmountToKobo(raw)).toEqual({ ok: true, kobo });
  });

  it.each([null, undefined, "", "   "])("treats %j as missing", (raw) => {
    expect(parseAmountToKobo(raw)).toEqual({ ok: false, reason: "missing" });
  });

  it.each(["abc", "12.345", "1.2.3", "5000 naira", "$500", "12-5", Number.NaN])(
    "rejects %j as invalid",
    (raw) => {
      expect(parseAmountToKobo(raw)).toEqual({ ok: false, reason: "invalid" });
    },
  );
});

describe("normalisation", () => {
  it("normalises employee numbers", () => {
    expect(normalizeEmployeeNo(" ab 123 ")).toBe("AB123");
    expect(normalizeEmployeeNo(123456)).toBe("123456");
    expect(normalizeEmployeeNo("  ")).toBeNull();
  });

  it("normalises Nigerian phone numbers", () => {
    expect(normalizePhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizePhone("+234-803-123-4567")).toBe("+2348031234567");
    expect(normalizePhone("2348031234567")).toBe("+2348031234567");
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeUndefined();
  });
});
