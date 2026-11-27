/** Request-scoped auth helpers for Server Components and Server Actions. */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Permission } from "@/lib/permissions";
import type { Actor } from "../audit";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession } from "./token";
import { loadSessionUser, type SessionUser } from "./users";

export async function startSession(userId: number) {
  (await cookies()).set(SESSION_COOKIE, await signSession(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const uid = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return uid ? loadSessionUser(uid) : null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account/password");
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.permissions.has(permission)) redirect("/forbidden");
  return user;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

export async function actorFor(user: SessionUser): Promise<Actor> {
  return { userId: user.id, ip: await clientIp() };
}

/** Actor for loan rules, which depend on who the user is as a member and what they may do. */
export async function loanActorFor(user: SessionUser): Promise<import("../loans/applications").LoanActor> {
  return { ...(await actorFor(user)), memberId: user.memberId, permissions: user.permissions };
}
