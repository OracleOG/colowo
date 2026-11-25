/** Database configuration checks (no connection is opened here). */
/** Why the configured DATABASE_URL can't work, or null if it looks usable. */
export function databaseConfigError(url: string | undefined): string | null {
  const hint =
    "Start Colowo with `npm run dev` (it runs a built-in local database), or set DATABASE_URL in .env.local to a real PostgreSQL connection string.";
  if (!url?.trim()) return `No database is configured. ${hint}`;
  try {
    const host = new URL(url).hostname;
    if (host === "host" || host === "your-host") return `DATABASE_URL is still the example placeholder. ${hint}`;
  } catch {
    return `DATABASE_URL isn't a valid connection string. ${hint}`;
  }
  return null;
}
