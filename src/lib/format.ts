/** Display helpers. Storage is UTC + integer kobo; display is Africa/Lagos + ₦. */
export const TIMEZONE = "Africa/Lagos";

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
});

export function formatKobo(kobo: number): string {
  return naira.format(kobo / 100);
}

export function formatDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(d));
}

/** Format a calendar date string (YYYY-MM-DD) without timezone shifting. */
export function formatDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Today's date in Lagos as YYYY-MM-DD. */
export function todayLagos(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}
