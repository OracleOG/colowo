/** Normalisation shared by forms, imports and migration, so matching is consistent. */

/**
 * Employee numbers: trim, upper-case, drop internal spaces.
 * NOTE: Excel often stores numeric IDs as numbers and drops leading zeros.
 * Once we see the bank's sample file we may need to left-pad here.
 */
export function normalizeEmployeeNo(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  return s === "" ? null : s;
}

/** Collapse whitespace and lower-case, for name comparisons. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Tidy a display name: collapse spaces. Case is left as entered. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Nigerian phone numbers to E.164 (+234XXXXXXXXXX).
 * Returns null for blank, throws-free `undefined` for invalid.
 */
export function normalizePhone(raw: string | null | undefined): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim();
  if (s === "") return null;
  const digits = s.replace(/[\s\-().]/g, "");
  let m: RegExpExecArray | null;
  if ((m = /^0(\d{10})$/.exec(digits))) return `+234${m[1]}`;
  if ((m = /^\+?234(\d{10})$/.exec(digits))) return `+234${m[1]}`;
  if (/^\+\d{8,15}$/.test(digits)) return digits; // other international numbers
  return undefined;
}
