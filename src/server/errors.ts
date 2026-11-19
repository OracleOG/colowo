/** A business-rule failure with a stable code the UI can show or branch on. */
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public field?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** Postgres error (drizzle wraps the driver error in `.cause`). */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  const e = (err as { cause?: unknown })?.cause ?? err;
  return (e ?? {}) as { code?: string; constraint?: string };
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err);
  return e.code === "23505" && (!constraint || e.constraint === constraint);
}
