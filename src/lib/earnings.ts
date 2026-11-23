/**
 * Savings earnings — the cooperative's rule, taken from its personal account
 * sheets and verified to the kobo against them for 2019–2025:
 *
 *   opening balance of year Y      = all savings movements before Y (principal only;
 *                                    earlier years' earnings are NOT added)
 *   for each month m of Y:
 *     interest[m] = balance[m-1] × monthly rate in force for m
 *     balance[m]  = balance[m-1] + movements[m] + interest[m]
 *   earnings for Y = Σ interest[m]   (rounded to kobo once, at the end)
 *
 * So interest compounds monthly within a year, and restarts from principal each
 * January. The yearly payout is a percentage of these earnings, set per year.
 *
 * Arithmetic is exact: balances are BigInt in units of 10⁻¹² kobo and rates in
 * millionths, so results don't drift the way spreadsheet floats can.
 */
import { addMonths, makePeriod, type Period } from "./period";

const SCALE = 10n ** 12n; // sub-kobo precision for running balances
const PPM = 1_000_000n;

/** "0.0042" → 4200 (parts per million). Exact, string-based. */
export function rateToPpm(rate: string | number): bigint {
  const s = typeof rate === "number" ? rate.toFixed(6) : rate.trim();
  const m = /^(\d+)(?:\.(\d{0,6})\d*)?$/.exec(s);
  if (!m) throw new Error(`Invalid rate: ${rate}`);
  return BigInt(m[1]) * PPM + BigInt((m[2] ?? "").padEnd(6, "0"));
}

export type RateTable = { effectiveFrom: Period; monthlyRate: string }[];

/** Rate in force for a period: the latest entry effective on or before it (0 if none). */
export function rateFor(table: RateTable, p: Period): bigint {
  let best: { effectiveFrom: Period; monthlyRate: string } | null = null;
  for (const r of table) {
    if (r.effectiveFrom <= p && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  }
  return best ? rateToPpm(best.monthlyRate) : 0n;
}

function roundHalfUp(scaled: bigint): number {
  const half = SCALE / 2n;
  const q = scaled >= 0n ? (scaled + half) / SCALE : -((-scaled + half) / SCALE);
  return Number(q);
}

export type YearEarnings = {
  year: number;
  openingKobo: number;
  movementsKobo: number;
  closingKobo: number;
  earningsKobo: number;
  /** Months included (12 for a closed year; fewer for the current year). */
  monthsCounted: number;
};

/**
 * @param movements net savings movement per period, in kobo (contributions,
 *        withdrawals, adjustments, reversals — everything in the savings ledger)
 * @param throughMonth stop after this month (for "earnings so far this year")
 */
export function computeYearEarnings(
  movements: Map<Period, number>,
  year: number,
  rates: RateTable,
  throughMonth = 12,
): YearEarnings {
  const first = makePeriod(year, 1);
  let opening = 0;
  for (const [p, amt] of movements) if (p < first) opening += amt;

  let balance = BigInt(opening) * SCALE;
  let interest = 0n;
  let moved = 0;
  let p = first;
  for (let m = 1; m <= throughMonth; m++, p = addMonths(p, 1)) {
    const i = (balance * rateFor(rates, p)) / PPM;
    const mv = movements.get(p) ?? 0;
    balance += BigInt(mv) * SCALE + i;
    interest += i;
    moved += mv;
  }
  return {
    year,
    openingKobo: opening,
    movementsKobo: moved,
    closingKobo: opening + moved,
    earningsKobo: roundHalfUp(interest),
    monthsCounted: throughMonth,
  };
}
