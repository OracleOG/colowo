/** User accounts, passwords and login checks (framework-independent, testable). */
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { members, rolePermissions, roles, userRoles, users, type User } from "@/db/schema";
import type { Permission } from "@/lib/permissions";
import { writeAudit, type Actor } from "../audit";
import { DomainError, isUniqueViolation } from "../errors";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 8;

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function assertPasswordStrength(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(
      "WEAK_PASSWORD",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      "password",
    );
  }
}

// Compared against for unknown users so they take as long as a wrong password.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("colowo-timing-guard", 12));

export type LoginResult =
  | { ok: true; userId: number; mustChangePassword: boolean }
  | { ok: false; reason: "invalid" | "locked" };

export async function attemptLogin(login: string, password: string, ip?: string | null): Promise<LoginResult> {
  const [user] = await db.select().from(users).where(eq(users.login, normalizeLogin(login)));
  if (!user || !user.isActive) {
    await bcrypt.compare(password, await getDummyHash());
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false, reason: "locked" };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
    if (lock) {
      await writeAudit(db, { userId: null, ip }, {
        action: "user.locked",
        entityType: "user",
        entityId: user.id,
        after: { lockedForMinutes: LOCK_MINUTES },
      });
    }
    return { ok: false, reason: lock ? "locked" : "invalid" };
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));
  return { ok: true, userId: user.id, mustChangePassword: user.mustChangePassword };
}

export type SessionUser = Pick<
  User,
  "id" | "login" | "displayName" | "memberId" | "mustChangePassword"
> & { permissions: Set<Permission>; roles: string[] };

export async function loadSessionUser(userId: number): Promise<SessionUser | null> {
  const [user] = await db
    .select({
      id: users.id,
      login: users.login,
      displayName: users.displayName,
      memberId: users.memberId,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true)));
  if (!user) return null;

  const rows = await db
    .select({ role: roles.code, perm: rolePermissions.permissionCode })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return {
    ...user,
    roles: [...new Set(rows.map((r) => r.role))],
    permissions: new Set(rows.flatMap((r) => (r.perm ? [r.perm as Permission] : []))),
  };
}

export async function changePassword(actor: Actor, userId: number, current: string, next: string) {
  assertPasswordStrength(next);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
    throw new DomainError("WRONG_PASSWORD", "Your current password is incorrect.", "current");
  }
  if (current === next) {
    throw new DomainError("WEAK_PASSWORD", "Choose a password different from the current one.", "password");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(next), mustChangePassword: false })
      .where(eq(users.id, userId));
    await writeAudit(tx, actor, { action: "user.password_change", entityType: "user", entityId: userId });
  });
}

/** Create a login. Members log in with their member number. */
export async function createUser(
  actor: Actor,
  input: {
    login: string;
    displayName: string;
    password: string;
    roleCodes: string[];
    memberId?: number | null;
    mustChangePassword?: boolean;
  },
  tx?: DbOrTx,
): Promise<User> {
  assertPasswordStrength(input.password);
  const run = async (t: DbOrTx) => {
    const roleRows = await t.select().from(roles).where(inArray(roles.code, input.roleCodes));
    if (roleRows.length !== input.roleCodes.length) {
      throw new DomainError("UNKNOWN_ROLE", "One or more roles do not exist.");
    }
    const [user] = await t
      .insert(users)
      .values({
        login: normalizeLogin(input.login),
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
        memberId: input.memberId ?? null,
        mustChangePassword: input.mustChangePassword ?? true,
      })
      .returning();
    await t.insert(userRoles).values(roleRows.map((r) => ({ userId: user.id, roleId: r.id })));
    await writeAudit(t, actor, {
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      after: { login: user.login, roles: input.roleCodes, memberId: user.memberId },
    });
    return user;
  };
  try {
    return tx ? await run(tx) : await db.transaction(run);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError("LOGIN_TAKEN", "A login already exists for that email or member.");
    }
    throw err;
  }
}

/** Give a member a login (member number + temporary password). */
export async function createMemberLogin(actor: Actor, memberId: number, tempPassword: string) {
  const [m] = await db.select().from(members).where(eq(members.id, memberId));
  if (!m) throw new DomainError("NOT_FOUND", "Member not found.");
  return createUser(actor, {
    login: m.memberNo,
    displayName: m.fullName,
    password: tempPassword,
    roleCodes: ["member"],
    memberId,
    mustChangePassword: true,
  });
}

export async function memberHasLogin(memberId: number): Promise<boolean> {
  const r = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${users} where ${users.memberId} = ${memberId}`,
  );
  return r.rows[0].n > 0;
}
