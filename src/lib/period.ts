/** Accounting periods are "YYYY-MM" strings; they sort correctly as text. */
export type Period = string;

const RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriod(s: unknown): s is Period {
  return typeof s === "string" && RE.test(s);
}

export function makePeriod(year: number, month: number): Period {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function periodParts(p: Period): { year: number; month: number } {
  const m = RE.exec(p);
  if (!m) throw new Error(`Invalid period: ${p}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function addMonths(p: Period, n: number): Period {
  const { year, month } = periodParts(p);
  const idx = year * 12 + (month - 1) + n;
  return makePeriod(Math.floor(idx / 12), (idx % 12) + 1);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatPeriod(p: Period): string {
  const { year, month } = periodParts(p);
  return `${MONTHS[month - 1]} ${year}`;
}

/** Parse "May 2026", "MAY,2026", "Sept 2025"… into a period. */
export function parsePeriodLabel(text: string): Period | null {
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.'’-]*(\d{4})\b/i.exec(text);
  if (!m) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(m[1].toLowerCase())) + 1;
  return makePeriod(Number(m[2]), month);
}

/** Period containing a YYYY-MM-DD date. */
export function periodOf(ymd: string): Period {
  return ymd.slice(0, 7);
}
