/**
 * Loan offer arithmetic. Interest is flat for the whole loan and added to what
 * the member repays (as in the cooperative's personal sheets) — [CONFIRM].
 * Exact integer maths on kobo; the monthly instalment is rounded UP to whole
 * naira so the final month is the smaller one.
 */
export type LoanTerms = { interestKobo: number; totalKobo: number; instalmentKobo: number; lastInstalmentKobo: number };

/** "10" or "7.5" → millionths of a percent, exactly. */
function percentToMicro(rate: string): bigint {
  const m = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(rate.trim());
  if (!m) throw new Error(`Invalid rate: ${rate}`);
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}

export function isValidRatePercent(rate: string): boolean {
  try {
    return percentToMicro(rate) <= 100_000_000n;
  } catch {
    return false;
  }
}

export function computeLoanTerms(amountKobo: number, ratePercent: string, tenureMonths: number): LoanTerms {
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) throw new Error("Amount must be positive");
  if (!Number.isInteger(tenureMonths) || tenureMonths < 1) throw new Error("Tenure must be at least one month");
  const denom = 100n * 1_000_000n;
  const raw = BigInt(amountKobo) * percentToMicro(ratePercent);
  const interestKobo = Number((raw + denom / 2n) / denom); // round half up
  const totalKobo = amountKobo + interestKobo;
  const perMonth = Math.ceil(totalKobo / tenureMonths / 100) * 100; // whole naira, rounded up
  const instalmentKobo = Math.min(perMonth, totalKobo);
  const lastInstalmentKobo = totalKobo - instalmentKobo * (tenureMonths - 1);
  return { interestKobo, totalKobo, instalmentKobo, lastInstalmentKobo: Math.max(lastInstalmentKobo, 0) };
}
