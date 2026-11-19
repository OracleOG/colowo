/**
 * Money parsing. Amounts are stored as integer kobo; floats are never used
 * for arithmetic. Parsing is string-based so "1,234.56" becomes exactly 123456.
 */

export type ParsedAmount =
  | { ok: true; kobo: number }
  | { ok: false; reason: "missing" | "invalid" };

/**
 * Parse an amount as it appears in a bank file or form field.
 * Accepts: 1234, "1,234.50", "₦1,234.5", "NGN 1 234.50", "(500.00)" (negative).
 * Rejects anything with stray characters that can't be cleaned safely,
 * or more than 2 decimal places.
 */
export function parseAmountToKobo(raw: unknown): ParsedAmount {
  if (raw === null || raw === undefined) return { ok: false, reason: "missing" };

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: "invalid" };
    // Excel numbers: round to 2dp via string to avoid binary float error.
    return parseAmountToKobo(raw.toFixed(2));
  }

  let s = String(raw).trim();
  if (s === "") return { ok: false, reason: "missing" };

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(₦|NGN|N(?=[\d\s]))\s*/i, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  // Thousands separators: commas, spaces, non-breaking spaces.
  s = s.replace(/[,\s ]/g, "");

  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return { ok: false, reason: "invalid" };

  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0"));
  const kobo = whole * 100 + frac;
  if (!Number.isSafeInteger(kobo)) return { ok: false, reason: "invalid" };
  return { ok: true, kobo: negative ? -kobo : kobo };
}
