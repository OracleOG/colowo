import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { SYSTEM } from "@/server/audit";
import { syncRolesAndPermissions } from "@/server/auth/roles";
import { attemptLogin, createMemberLogin, createUser, loadSessionUser, MAX_FAILED_LOGINS } from "@/server/auth/users";
import { createMember } from "@/server/members";

beforeAll(async () => {
  await db.transaction((tx) => syncRolesAndPermissions(tx));
});
afterAll(() => pool.end());

describe("login", () => {
  it("logs in case-insensitively and rejects wrong passwords", async () => {
    await createUser(SYSTEM, {
      login: "Officer@Coop.ng",
      displayName: "Officer",
      password: "correct-horse",
      roleCodes: ["finance_officer"],
    });
    expect(await attemptLogin(" officer@coop.ng ", "correct-horse")).toMatchObject({ ok: true });
    expect(await attemptLogin("officer@coop.ng", "wrong-pass")).toEqual({ ok: false, reason: "invalid" });
    expect(await attemptLogin("nobody@coop.ng", "whatever1")).toEqual({ ok: false, reason: "invalid" });
  });

  it(`locks the account after ${MAX_FAILED_LOGINS} failures, even for the right password`, async () => {
    await createUser(SYSTEM, { login: "lock@coop.ng", displayName: "L", password: "right-pass", roleCodes: ["viewer"] });
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) {
      expect((await attemptLogin("lock@coop.ng", "bad-pass")).ok).toBe(false);
    }
    expect(await attemptLogin("lock@coop.ng", "bad-pass")).toEqual({ ok: false, reason: "locked" });
    expect(await attemptLogin("lock@coop.ng", "right-pass")).toEqual({ ok: false, reason: "locked" });
  });
});

describe("roles", () => {
  it("gives members only self.view, linked to their own member record", async () => {
    const m = await createMember(SYSTEM, { fullName: "Auth Member", dateJoined: "2022-01-01" });
    const u = await createMemberLogin(SYSTEM, m.id, "member-pass");
    expect(u.login).toBe(m.memberNo.toLowerCase());
    const s = await loadSessionUser(u.id);
    expect(s?.memberId).toBe(m.id);
    expect([...s!.permissions]).toEqual(["self.view"]);
  });

  it("gives finance officers import rights but not loan approval or user management", async () => {
    const u = await createUser(SYSTEM, { login: "fo2@coop.ng", displayName: "FO", password: "pass-word", roleCodes: ["finance_officer"] });
    const s = (await loadSessionUser(u.id))!;
    expect(s.permissions.has("import.commit")).toBe(true);
    expect(s.permissions.has("loan.approve")).toBe(false);
    expect(s.permissions.has("user.manage")).toBe(false);
  });
});
