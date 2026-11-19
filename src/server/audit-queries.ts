import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";

export async function listAudit(filter: {
  entityType?: string;
  entityId?: string;
  action?: string;
  userId?: number;
  from?: string; // YYYY-MM-DD (Lagos)
  to?: string;
  limit?: number;
}) {
  const conds: SQL[] = [];
  if (filter.entityType) conds.push(eq(auditLog.entityType, filter.entityType));
  if (filter.entityId) conds.push(eq(auditLog.entityId, filter.entityId));
  if (filter.action) conds.push(eq(auditLog.action, filter.action));
  if (filter.userId) conds.push(eq(auditLog.userId, filter.userId));
  if (filter.from) conds.push(gte(auditLog.at, new Date(`${filter.from}T00:00:00+01:00`)));
  if (filter.to) {
    const end = new Date(`${filter.to}T00:00:00+01:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    conds.push(lt(auditLog.at, end));
  }
  return db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      ip: auditLog.ip,
      userName: users.displayName,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(filter.limit ?? 200);
}

export type AuditRow = Awaited<ReturnType<typeof listAudit>>[number];
