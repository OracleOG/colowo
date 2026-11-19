import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { auditLog, members } from "@/db/schema";
import { SYSTEM } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { changeMemberStatus, createMember, updateMember } from "@/server/members";

const actor = SYSTEM;
let seq = 0;
const base = (over: Record<string, unknown> = {}) => ({
  fullName: `Test Member ${++seq}`,
  employeeNo: `E${1000 + seq}`,
  phone: null,
  dateJoined: "2021-03-01",
  ...over,
});

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);
}

beforeAll(async () => {
  await db.execute(sql`alter table members disable trigger members_no_delete`);
  await db.execute(sql`alter table audit_log disable trigger user`);
  await db.execute(sql`truncate audit_log, members restart identity cascade`);
  await db.execute(sql`alter table audit_log enable trigger user`);
  await db.execute(sql`alter table members enable trigger members_no_delete`);
});
afterAll(() => pool.end());

describe("member IDs", () => {
  it("issues sequential, unique member numbers", async () => {
    const a = await createMember(actor, base());
    const b = await createMember(actor, base());
    expect(a.memberNo).toMatch(/^CLW\d{5}$/);
    expect(a.memberNo).not.toBe(b.memberNo);
  });

  it("never lets member_no change (database trigger)", async () => {
    const m = await createMember(actor, base());
    await expect(
      db.update(members).set({ memberNo: "CLW99999" }).where(eq(members.id, m.id)),
    ).rejects.toThrow();
  });

  it("never deletes members (database trigger)", async () => {
    const m = await createMember(actor, base());
    await expect(db.delete(members).where(eq(members.id, m.id))).rejects.toThrow();
  });

  it("enforces unique member_no at the database level", async () => {
    const m = await createMember(actor, base());
    await expect(
      db.insert(members).values({ memberNo: m.memberNo, fullName: "X", dateJoined: "2020-01-01" }),
    ).rejects.toThrow();
  });
});

describe("employee numbers", () => {
  it("blocks a second live member with the same employee number", async () => {
    await createMember(actor, base({ employeeNo: "DUP-1" }));
    await expectCode(createMember(actor, base({ employeeNo: "dup-1" })), "EMPLOYEE_NO_TAKEN");
  });

  it("frees an employee number once its holder has exited", async () => {
    const old = await createMember(actor, base({ employeeNo: "REUSE-1" }));
    await changeMemberStatus(actor, old.id, { status: "exited", reason: "Retired", dateExited: "2024-01-31" });
    const fresh = await createMember(actor, base({ employeeNo: "REUSE-1" }));
    expect(fresh.employeeNo).toBe("REUSE-1");
  });

  it("blocks reactivating a suspended member whose number was reused", async () => {
    const s = await createMember(actor, base({ employeeNo: "SUSP-1" }));
    await changeMemberStatus(actor, s.id, { status: "suspended", reason: "Query" });
    // A suspended member still holds the number, so this must fail:
    await expectCode(createMember(actor, base({ employeeNo: "SUSP-1" })), "EMPLOYEE_NO_TAKEN");
  });
});

describe("duplicates and validation", () => {
  it("warns on same name + phone, and allows override", async () => {
    await createMember(actor, base({ fullName: "Ada  Obi", phone: "08031112222" }));
    await expectCode(
      createMember(actor, base({ fullName: "ada obi", phone: "+2348031112222" })),
      "POSSIBLE_DUPLICATE",
    );
    const ok = await createMember(actor, base({ fullName: "Ada Obi", phone: "08031112222" }), {
      allowDuplicate: true,
    });
    expect(ok.id).toBeGreaterThan(0);
  });

  it("rejects bad input with field errors", async () => {
    await expect(
      createMember(actor, base({ fullName: "A", phone: "123", email: "nope", dateJoined: "2999-01-01" })),
    ).rejects.toSatisfy((e) => {
      const d = (e as DomainError).details as Record<string, string[]>;
      return (e as DomainError).code === "VALIDATION" && !!d.fullName && !!d.phone && !!d.email && !!d.dateJoined;
    });
  });
});

describe("status changes", () => {
  it("requires a reason and an exit date, and makes exit final", async () => {
    const m = await createMember(actor, base());
    await expectCode(changeMemberStatus(actor, m.id, { status: "suspended", reason: " " }), "VALIDATION");
    await expectCode(changeMemberStatus(actor, m.id, { status: "exited", reason: "Left" }), "VALIDATION");
    await expectCode(
      changeMemberStatus(actor, m.id, { status: "exited", reason: "Left", dateExited: "2020-01-01" }),
      "VALIDATION",
    );
    const exited = await changeMemberStatus(actor, m.id, {
      status: "exited",
      reason: "Left",
      dateExited: "2025-06-30",
    });
    expect(exited.status).toBe("exited");
    await expectCode(changeMemberStatus(actor, m.id, { status: "active", reason: "Back" }), "INVALID_TRANSITION");
  });
});

describe("audit log", () => {
  it("records create, edit (changed fields only) and exit", async () => {
    const m = await createMember(actor, base({ phone: "08030000001" }));
    await updateMember(actor, m.id, base({ fullName: m.fullName, employeeNo: m.employeeNo, phone: "08030000002" }));
    await changeMemberStatus(actor, m.id, { status: "exited", reason: "Moved", dateExited: "2025-01-01" });

    const log = await db.select().from(auditLog).where(eq(auditLog.entityId, String(m.id))).orderBy(auditLog.id);
    expect(log.map((l) => l.action)).toEqual(["member.create", "member.update", "member.exit"]);
    expect(log[1].before).toEqual({ phone: "+2348030000001" });
    expect(log[1].after).toEqual({ phone: "+2348030000002" });
    expect(log[2].after).toMatchObject({ status: "exited", reason: "Moved" });
  });

  it("is append-only (database trigger)", async () => {
    await expect(db.update(auditLog).set({ action: "tampered" })).rejects.toThrow();
    await expect(db.delete(auditLog)).rejects.toThrow();
  });
});
