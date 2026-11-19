import { auditLog } from "@/db/schema";
import type { DbOrTx } from "@/db";

/** Who is performing an action. userId null = system (seed/migration). */
export type Actor = { userId: number | null; ip?: string | null };

export const SYSTEM: Actor = { userId: null };

export async function writeAudit(
  tx: DbOrTx,
  actor: Actor,
  entry: {
    action: string;
    entityType: string;
    entityId: string | number;
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.insert(auditLog).values({
    userId: actor.userId,
    ip: actor.ip ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId),
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

/** Only the fields that changed, as {before, after} — keeps the log readable. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] !== undefined && after[key] !== before[key]) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
