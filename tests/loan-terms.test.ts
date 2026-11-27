import { describe, expect, it } from "vitest";
import { computeLoanTerms, isValidRatePercent } from "@/lib/loan-terms";

describe("loan terms", () => {
  it("adds flat interest and spreads the total over the months", () => {
    // ₦100,000 at 10% over 10 months → ₦110,000, ₦11,000 a month
    expect(computeLoanTerms(100_000_00, "10", 10)).toEqual({
      interestKobo: 10_000_00,
      totalKobo: 110_000_00,
      instalmentKobo: 11_000_00,
      lastInstalmentKobo: 11_000_00,
    });
  });

  it("rounds the instalment up to whole naira and makes the last month smaller", () => {
    const t = computeLoanTerms(100_000_00, "7.5", 12); // total ₦107,500 / 12 = 8,958.33
    expect(t.totalKobo).toBe(107_500_00);
    expect(t.instalmentKobo).toBe(8_959_00);
    expect(t.lastInstalmentKobo).toBe(107_500_00 - 8_959_00 * 11);
    expect(t.instalmentKobo * 11 + t.lastInstalmentKobo).toBe(t.totalKobo);
  });

  it("handles zero interest and odd kobo", () => {
    expect(computeLoanTerms(50_000_00, "0", 5).instalmentKobo).toBe(10_000_00);
    expect(computeLoanTerms(333, "10", 1)).toMatchObject({ interestKobo: 33, totalKobo: 366, instalmentKobo: 366 });
  });

  it("validates rates", () => {
    expect(isValidRatePercent("10")).toBe(true);
    expect(isValidRatePercent("12.25")).toBe(true);
    expect(isValidRatePercent("-1")).toBe(false);
    expect(isValidRatePercent("abc")).toBe(false);
    expect(isValidRatePercent("150")).toBe(false);
  });
});
