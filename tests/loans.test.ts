import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { loanEvents, loanOffers } from "@/db/schema";
import { DEFAULT_ROLES, type Permission } from "@/lib/permissions";
import { addMonths, periodOf } from "@/lib/period";
import { todayLagos } from "@/lib/format";
import { DomainError } from "@/server/errors";
import {
  applyForLoan,
  cancelApplication,
  createScheme,
  getApplicationDetail,
  makeOffer,
  rejectApplication,
  respondToOffer,
  type LoanActor,
} from "@/server/loans/applications";
import { changeMemberStatus, createMember } from "@/server/members";
import { SYSTEM } from "@/server/audit";
import { resetDb } from "./helpers";

const perms = (role: string) => new Set<Permission>(DEFAULT_ROLES[role].permissions);
let ada: LoanActor, bayo: LoanActor, officer: LoanActor, approver: LoanActor, approverWhoIsMember: LoanActor;
const nextMonth = addMonths(periodOf(todayLagos()), 1);

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);
}

beforeAll(async () => {
  await resetDb();
  const a = await createMember(SYSTEM, { fullName: "Ada Loan", dateJoined: "2021-01-01" });
  const b = await createMember(SYSTEM, { fullName: "Bayo Loan", dateJoined: "2022-01-01" });
  const c = await createMember(SYSTEM, { fullName: "Chidi Committee", dateJoined: "2020-01-01" });
  // userId null keeps the audit FK happy without creating users; access rules use memberId + permissions.
  ada = { userId: null, memberId: a.id, permissions: perms("member") };
  bayo = { userId: null, memberId: b.id, permissions: perms("member") };
  officer = { userId: null, memberId: null, permissions: perms("loan_officer") };
  approver = { userId: null, memberId: null, permissions: perms("loan_approver") };
  approverWhoIsMember = { userId: null, memberId: c.id, permissions: new Set([...perms("loan_approver"), ...perms("member")]) };
});
afterAll(() => pool.end());

const offer = (amountNaira: number, over: Partial<Parameters<typeof makeOffer>[2]> = {}) => ({
  amountKobo: amountNaira * 100,
  ratePercent: "10",
  tenureMonths: 10,
  firstRepaymentPeriod: nextMonth,
  ...over,
});

describe("loan applications", () => {
  it("member applies for a general loan, gets a reduced offer, and accepts it", async () => {
    const app = await applyForLoan(ada, { memberId: ada.memberId!, loanType: "regular", requestedKobo: 200_000_00, purpose: "School fees" });
    expect(app).toMatchObject({ status: "submitted", schemeId: null, onBehalf: false });

    const o = await makeOffer(approver, app.id, offer(100_000, { conditions: "Guarantor required" }));
    expect(o).toMatchObject({ version: 1, amountKobo: 100_000_00, interestKobo: 10_000_00, totalKobo: 110_000_00, instalmentKobo: 11_000_00 });

    await respondToOffer(ada, app.id, { response: "accepted" });
    const d = (await getApplicationDetail(app.id))!;
    expect(d.app.status).toBe("accepted");
    expect(d.currentOffer!.response).toBe("accepted");
    expect(d.events.map((e) => e.e.kind).reverse()).toEqual(["applied", "offered", "accepted"]);
  });

  it("supports the adjustment loop, keeping every offer version", async () => {
    const app = await applyForLoan(bayo, { memberId: bayo.memberId!, loanType: "commodity", requestedKobo: 150_000_00, purpose: "Rice and oil" });
    await makeOffer(approver, app.id, offer(80_000));
    await expectCode(respondToOffer(bayo, app.id, { response: "adjustment_requested", note: " " }), "VALIDATION");
    await respondToOffer(bayo, app.id, { response: "adjustment_requested", note: "Can I get 120,000 over 12 months?" });
    await makeOffer(approver, app.id, offer(120_000, { tenureMonths: 12 }));
    await respondToOffer(bayo, app.id, { response: "declined", note: "Changed my mind" });
    const d = (await getApplicationDetail(app.id))!;
    expect(d.app.status).toBe("declined");
    expect(d.offers.map((o) => [o.version, o.amountKobo, o.response])).toEqual([
      [2, 120_000_00, "declined"],
      [1, 80_000_00, "adjustment_requested"],
    ]);
  });

  it("lets an officer do every member step on the member's behalf, and records it", async () => {
    const app = await applyForLoan(officer, { memberId: bayo.memberId!, loanType: "regular", requestedKobo: 50_000_00, purpose: "Rent (applied at the office)" });
    expect(app.onBehalf).toBe(true);
    await makeOffer(approver, app.id, offer(50_000));
    await respondToOffer(officer, app.id, { response: "accepted", note: "Member signed the form" });
    const [o] = await db.select().from(loanOffers).where(eq(loanOffers.applicationId, app.id));
    expect(o.respondedOnBehalf).toBe(true);
    const evs = await db.select().from(loanEvents).where(eq(loanEvents.applicationId, app.id));
    expect(evs.filter((e) => e.onBehalf).map((e) => e.kind).sort()).toEqual(["accepted", "applied"]);
  });

  it("stops members acting on someone else's loan, and officers from making offers", async () => {
    const app = await applyForLoan(ada, { memberId: ada.memberId!, loanType: "commodity", requestedKobo: 30_000_00, purpose: "Provisions" });
    await expectCode(cancelApplication(bayo, app.id, "not mine"), "FORBIDDEN");
    await expectCode(applyForLoan(bayo, { memberId: ada.memberId!, loanType: "regular", requestedKobo: 1_00, purpose: "Sneaky" }), "FORBIDDEN");
    await expectCode(makeOffer(officer, app.id, offer(30_000)), "FORBIDDEN");
    await expectCode(makeOffer(ada, app.id, offer(30_000)), "FORBIDDEN");
  });

  it("never lets an approver decide their own application", async () => {
    const own = await applyForLoan(approverWhoIsMember, { memberId: approverWhoIsMember.memberId!, loanType: "regular", requestedKobo: 70_000_00, purpose: "Own loan" });
    await expectCode(makeOffer(approverWhoIsMember, own.id, offer(70_000)), "OWN_APPLICATION");
    await expectCode(rejectApplication(approverWhoIsMember, own.id, "no"), "OWN_APPLICATION");
    await makeOffer(approver, own.id, offer(70_000)); // a different approver can
  });

  it("blocks a second open application of the same kind; cancelling (before payout) frees it", async () => {
    // Ada's first regular loan is accepted and not yet paid out, so it's still open.
    await expectCode(
      applyForLoan(ada, { memberId: ada.memberId!, loanType: "regular", requestedKobo: 10_000_00, purpose: "Second regular" }),
      "DUPLICATE_APPLICATION",
    );
    const [accepted] = (await db.execute<{ id: string }>(sql`select id from loan_applications where member_id = ${ada.memberId} and status = 'accepted' and loan_type = 'regular'`)).rows;
    await cancelApplication(ada, Number(accepted.id), "Found the money elsewhere");
    const again = await applyForLoan(ada, { memberId: ada.memberId!, loanType: "regular", requestedKobo: 10_000_00, purpose: "Second regular" });
    expect(again.status).toBe("submitted");
    await expectCode(cancelApplication(ada, Number(accepted.id), "twice"), "INVALID_STATUS");
  });
});

describe("schemes, rejection, expiry", () => {
  it("applies under an open scheme with its maximum, and refuses closed schemes", async () => {
    const today = todayLagos();
    const s = await createScheme(approver, {
      name: "December special",
      type: "special",
      maxPerMemberKobo: 300_000_00,
      defaultRatePercent: "10",
      defaultTenureMonths: 10,
      opensOn: today,
    });
    await expectCode(
      applyForLoan(bayo, { memberId: bayo.memberId!, schemeId: s.id, requestedKobo: 400_000_00, purpose: "Too much" }),
      "OVER_SCHEME_MAX",
    );
    const app = await applyForLoan(bayo, { memberId: bayo.memberId!, schemeId: s.id, requestedKobo: 300_000_00, purpose: "Business" });
    expect(app.loanType).toBe("special");
    await expectCode(applyForLoan(bayo, { memberId: bayo.memberId!, schemeId: s.id, requestedKobo: 1_000_00, purpose: "Again" }), "DUPLICATE_APPLICATION");
    await rejectApplication(approver, app.id, "Pool exhausted");
    expect((await getApplicationDetail(app.id))!.app.status).toBe("rejected");

    const future = await createScheme(approver, { name: "Next year", type: "regular", defaultRatePercent: "8", defaultTenureMonths: 12, opensOn: "2099-01-01" });
    await expectCode(applyForLoan(bayo, { memberId: bayo.memberId!, schemeId: future.id, requestedKobo: 1_000_00, purpose: "Early" }), "SCHEME_CLOSED");
  });

  it("refuses to accept an expired offer", async () => {
    const app = await applyForLoan(bayo, { memberId: bayo.memberId!, loanType: "commodity", requestedKobo: 20_000_00, purpose: "Late reply" });
    await makeOffer(approver, app.id, offer(20_000, { validDays: -1 }));
    await expectCode(respondToOffer(bayo, app.id, { response: "accepted" }), "OFFER_EXPIRED");
    await makeOffer(approver, app.id, offer(20_000)); // re-offer
    await respondToOffer(bayo, app.id, { response: "accepted" });
  });

  it("doesn't let exited members apply", async () => {
    const gone = await createMember(SYSTEM, { fullName: "Gone Member", dateJoined: "2020-01-01" });
    await changeMemberStatus(SYSTEM, gone.id, { status: "exited", reason: "Left", dateExited: "2025-01-01" });
    await expectCode(applyForLoan(officer, { memberId: gone.id, loanType: "regular", requestedKobo: 1_000_00, purpose: "Nope" }), "MEMBER_NOT_ACTIVE");
  });

  it("keeps offer terms and the timeline unchangeable (database rules)", async () => {
    const [o] = await db.select().from(loanOffers).limit(1);
    await expect(db.update(loanOffers).set({ amountKobo: 1 }).where(eq(loanOffers.id, o.id))).rejects.toThrow();
    await expect(db.delete(loanOffers).where(eq(loanOffers.id, o.id))).rejects.toThrow();
    await expect(db.execute(sql`update loan_events set note = 'x'`)).rejects.toThrow();
  });
});
