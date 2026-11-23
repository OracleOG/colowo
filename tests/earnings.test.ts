import { describe, expect, it } from "vitest";
import { computeYearEarnings, rateFor, rateToPpm, type RateTable } from "@/lib/earnings";
import { addMonths, parsePeriodLabel } from "@/lib/period";
import sample from "./fixtures/personal-sheet-sample.json";

const RATES: RateTable = [
  { effectiveFrom: "2019-01", monthlyRate: "0.004200" },
  { effectiveFrom: "2022-01", monthlyRate: "0.005000" },
];

const movements = new Map(Object.entries(sample.contributions).map(([p, naira]) => [p, naira * 100]));

describe("earnings match the cooperative's personal account sheet", () => {
  for (const [year, expected] of Object.entries(sample.yearly)) {
    it(`${year}: principal ₦${expected.closingPrincipal}, earnings ₦${expected.earnings}`, () => {
      const r = computeYearEarnings(movements, Number(year), RATES);
      expect(r.closingKobo).toBe(expected.closingPrincipal * 100);
      expect(r.earningsKobo).toBe(Math.round(expected.earnings * 100));
    });
  }

  it("does not carry earnings into the next year's opening balance", () => {
    const y2019 = computeYearEarnings(movements, 2019, RATES);
    const y2020 = computeYearEarnings(movements, 2020, RATES);
    expect(y2020.openingKobo).toBe(y2019.closingKobo);
  });

  it("supports earnings-to-date for a part year", () => {
    const full = computeYearEarnings(movements, 2025, RATES);
    const part = computeYearEarnings(movements, 2025, RATES, 6);
    expect(part.earningsKobo).toBeGreaterThan(0);
    expect(part.earningsKobo).toBeLessThan(full.earningsKobo);
  });

  it("includes withdrawals (negative movements) in the running balance", () => {
    const m = new Map([["2024-01", 100_000_00], ["2024-07", -50_000_00]]);
    const r = computeYearEarnings(m, 2024, RATES);
    expect(r.closingKobo).toBe(50_000_00);
    // Jan: 0; Feb–Jul on 100k (6 months), Aug–Dec on ~50.5k — far less than 11 months on 100k
    expect(r.earningsKobo).toBeLessThan(computeYearEarnings(new Map([["2024-01", 100_000_00]]), 2024, RATES).earningsKobo);
  });
});

describe("rates and periods", () => {
  it("parses rates exactly", () => {
    expect(rateToPpm("0.0042")).toBe(4200n);
    expect(rateToPpm("0.005000")).toBe(5000n);
    expect(rateToPpm(0.005)).toBe(5000n);
  });
  it("picks the rate in force", () => {
    expect(rateFor(RATES, "2018-12")).toBe(0n);
    expect(rateFor(RATES, "2021-12")).toBe(4200n);
    expect(rateFor(RATES, "2022-01")).toBe(5000n);
  });
  it("handles periods", () => {
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(parsePeriodLabel("  BDTH STAFF M- PURPOSE COOP. SOC. May 2026".replace(/ /g, " "))).toBe("2026-05");
    expect(parsePeriodLabel("SEPT,2025")).toBe("2025-09");
    expect(parsePeriodLabel("no date here")).toBeNull();
  });
});
