/**
 * Loan schemes, applications and offers (docs/LOANS.md §1–2).
 *
 *   submitted ──offer──► offered ──accept──► accepted ──(payout, next phase)──► disbursed
 *       ▲                  │  └──decline──► declined
 *       └──revised offer───┴──request adjustment──► adjustment_requested
 *   rejected (approver) · cancelled (member or officer, any time before payout)
 *
 * Members do their own steps; staff with loan.manage can do the same steps on a
 * member's behalf (recorded as such). Offers need loan.approve, and nobody may
 * make an offer on their own application.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  loanApplications,
  loanEvents,
  loanOffers,
  loanSchemes,
  members,
  users,
  type LoanApplication,
  type LoanOffer,
  type LoanScheme,
} from "@/db/schema";
import { todayLagos } from "@/lib/format";
import { computeLoanTerms, isValidRatePercent } from "@/lib/loan-terms";
import { addMonths, isPeriod, periodOf, type Period } from "@/lib/period";
import type { Permission } from "@/lib/permissions";
import { writeAudit, type Actor } from "../audit";
import { DomainError } from "../errors";
import { getSavingsBalance } from "../savings/ledger";

export type LoanActor = Actor & { memberId: number | null; permissions: Set<Permission> };

export const OPEN_STATUSES: LoanApplication["status"][] = ["submitted", "offered", "adjustment_requested", "accepted"];
export const OFFER_VALID_DAYS = 14; // [CONFIRM]

/* ---------------------------- helpers ---------------------------- */

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function event(
  tx: DbOrTx,
  actor: LoanActor,
  applicationId: number,
  kind: string,
  note: string | null,
  onBehalf: boolean,
) {
  await tx.insert(loanEvents).values({ applicationId, kind, note, actorUserId: actor.userId, onBehalf });
  await writeAudit(tx, actor, {
    action: `loan.${kind}`,
    entityType: "loan_application",
    entityId: applicationId,
    after: { note, onBehalf },
  });
}

/**
 * May this actor do a member-side step (apply, respond, cancel) for this member?
 * Returns whether it's on the member's behalf.
 */
function memberSideAccess(actor: LoanActor, memberId: number): { onBehalf: boolean } {
  if (actor.memberId === memberId && actor.permissions.has("self.view")) return { onBehalf: false };
  if (actor.permissions.has("loan.manage")) return { onBehalf: actor.memberId !== memberId };
  throw new DomainError("FORBIDDEN", "You can only do this for your own loans.");
}

function requireApprover(actor: LoanActor, app: { memberId: number }) {
  if (!actor.permissions.has("loan.approve")) throw new DomainError("FORBIDDEN", "Only a loan approver can do this.");
  if (actor.memberId !== null && actor.memberId === app.memberId) {
    throw new DomainError("OWN_APPLICATION", "You can't make decisions on your own loan application.");
  }
}

async function lockApplication(tx: DbOrTx, id: number) {
  const [app] = await tx.select().from(loanApplications).where(eq(loanApplications.id, id)).for("update");
  if (!app) throw new DomainError("NOT_FOUND", "Loan application not found.");
  return app;
}

async function latestOffer(tx: DbOrTx, applicationId: number): Promise<LoanOffer | null> {
  const [o] = await tx
    .select()
    .from(loanOffers)
    .where(eq(loanOffers.applicationId, applicationId))
    .orderBy(desc(loanOffers.version))
    .limit(1);
  return o ?? null;
}

/* ---------------------------- schemes ---------------------------- */

export type SchemeInput = {
  name: string;
  type: LoanScheme["type"];
  description?: string;
  poolKobo?: number | null;
  maxPerMemberKobo?: number | null;
  defaultRatePercent: string;
  defaultTenureMonths: number;
  opensOn: string;
  closesOn?: string | null;
};

export async function createScheme(actor: LoanActor, input: SchemeInput): Promise<LoanScheme> {
  if (!actor.permissions.has("loan.approve")) throw new DomainError("FORBIDDEN", "Only a loan approver can create schemes.");
  const name = input.name.trim();
  if (name.length < 3) throw new DomainError("VALIDATION", "Give the scheme a name.", "name");
  if (!isValidRatePercent(input.defaultRatePercent)) throw new DomainError("VALIDATION", "Enter the interest rate in percent, e.g. 10.", "defaultRatePercent");
  if (!Number.isInteger(input.defaultTenureMonths) || input.defaultTenureMonths < 1 || input.defaultTenureMonths > 120) {
    throw new DomainError("VALIDATION", "Repayment period must be 1–120 months.", "defaultTenureMonths");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.opensOn)) throw new DomainError("VALIDATION", "Choose the opening date.", "opensOn");
  if (input.closesOn && input.closesOn < input.opensOn) throw new DomainError("VALIDATION", "Closing date is before the opening date.", "closesOn");
  for (const [k, v] of [["poolKobo", input.poolKobo], ["maxPerMemberKobo", input.maxPerMemberKobo]] as const) {
    if (v !== null && v !== undefined && (!Number.isSafeInteger(v) || v <= 0)) throw new DomainError("VALIDATION", "Enter a valid amount.", k);
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(loanSchemes)
      .values({
        name,
        type: input.type,
        description: input.description?.trim() || null,
        poolKobo: input.poolKobo ?? null,
        maxPerMemberKobo: input.maxPerMemberKobo ?? null,
        defaultRatePercent: input.defaultRatePercent.trim(),
        defaultTenureMonths: input.defaultTenureMonths,
        opensOn: input.opensOn,
        closesOn: input.closesOn || null,
        createdBy: actor.userId,
      })
      .returning();
    await writeAudit(tx, actor, { action: "loan.scheme_create", entityType: "loan_scheme", entityId: row.id, after: row });
    return row;
  });
}

export async function setSchemeStatus(actor: LoanActor, id: number, status: LoanScheme["status"]) {
  if (!actor.permissions.has("loan.approve")) throw new DomainError("FORBIDDEN", "Only a loan approver can change schemes.");
  await db.transaction(async (tx) => {
    const [row] = await tx.update(loanSchemes).set({ status }).where(eq(loanSchemes.id, id)).returning();
    if (!row) throw new DomainError("NOT_FOUND", "Scheme not found.");
    await writeAudit(tx, actor, { action: `loan.scheme_${status}`, entityType: "loan_scheme", entityId: id });
  });
}

function schemeIsOpen(s: LoanScheme, today = todayLagos()) {
  return s.status === "open" && s.opensOn <= today && (!s.closesOn || s.closesOn >= today);
}

/** Schemes with what has been offered/committed against them so far. */
export async function listSchemes(opts: { openOnly?: boolean } = {}) {
  const rows = await db
    .select({
      scheme: loanSchemes,
      applications: sql<number>`count(${loanApplications.id})::int`,
      committedKobo: sql<string>`coalesce(sum(case when ${loanApplications.status} in ('accepted','disbursed') then (
        select o.amount_kobo from loan_offers o where o.application_id = ${loanApplications.id} order by o.version desc limit 1) end), 0)`,
    })
    .from(loanSchemes)
    .leftJoin(loanApplications, eq(loanApplications.schemeId, loanSchemes.id))
    .groupBy(loanSchemes.id)
    .orderBy(desc(loanSchemes.id));
  const today = todayLagos();
  return rows
    .map((r) => ({ ...r.scheme, applications: r.applications, committedKobo: Number(r.committedKobo), isOpen: schemeIsOpen(r.scheme, today) }))
    .filter((s) => !opts.openOnly || s.isOpen);
}

/* ---------------------------- apply ---------------------------- */

export type ApplyInput = {
  memberId: number;
  schemeId?: number | null;
  loanType?: LoanApplication["loanType"];
  requestedKobo: number;
  purpose: string;
  preferredTenureMonths?: number | null;
};

export async function applyForLoan(actor: LoanActor, input: ApplyInput): Promise<LoanApplication> {
  const { onBehalf } = memberSideAccess(actor, input.memberId);
  if (!Number.isSafeInteger(input.requestedKobo) || input.requestedKobo <= 0) {
    throw new DomainError("VALIDATION", "Enter the amount you want to borrow.", "amount");
  }
  const purpose = input.purpose.trim();
  if (purpose.length < 3) throw new DomainError("VALIDATION", "Say briefly what the loan is for.", "purpose");
  const tenure = input.preferredTenureMonths ?? null;
  if (tenure !== null && (!Number.isInteger(tenure) || tenure < 1 || tenure > 120)) {
    throw new DomainError("VALIDATION", "Repayment period must be 1–120 months.", "tenure");
  }

  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(members).where(eq(members.id, input.memberId)).for("update");
    if (!member) throw new DomainError("NOT_FOUND", "Member not found.");
    if (member.status !== "active") throw new DomainError("MEMBER_NOT_ACTIVE", `${member.fullName} is ${member.status} and can't apply for a loan.`);

    let scheme: LoanScheme | null = null;
    if (input.schemeId) {
      [scheme] = await tx.select().from(loanSchemes).where(eq(loanSchemes.id, input.schemeId));
      if (!scheme) throw new DomainError("NOT_FOUND", "Loan scheme not found.");
      if (!schemeIsOpen(scheme)) throw new DomainError("SCHEME_CLOSED", `"${scheme.name}" is not open for applications.`);
      if (scheme.maxPerMemberKobo && input.requestedKobo > scheme.maxPerMemberKobo) {
        throw new DomainError("OVER_SCHEME_MAX", `The most you can request under "${scheme.name}" is ₦${(scheme.maxPerMemberKobo / 100).toLocaleString("en-NG")}.`, "amount");
      }
    }
    const loanType = scheme?.type ?? input.loanType ?? "regular";

    // One open application at a time per scheme (or per type, for general requests).
    const [dup] = await tx
      .select({ id: loanApplications.id })
      .from(loanApplications)
      .where(
        and(
          eq(loanApplications.memberId, member.id),
          inArray(loanApplications.status, ["submitted", "offered", "adjustment_requested", "accepted"]),
          scheme ? eq(loanApplications.schemeId, scheme.id) : and(sql`${loanApplications.schemeId} is null`, eq(loanApplications.loanType, loanType)),
        ),
      )
      .limit(1);
    if (dup) {
      throw new DomainError("DUPLICATE_APPLICATION", `There is already an open application (#${dup.id}) for this loan. Cancel it first or wait for it to finish.`, undefined, { applicationId: dup.id });
    }

    const [app] = await tx
      .insert(loanApplications)
      .values({
        memberId: member.id,
        schemeId: scheme?.id ?? null,
        loanType,
        requestedKobo: input.requestedKobo,
        purpose,
        preferredTenureMonths: tenure,
        submittedBy: actor.userId,
        onBehalf,
      })
      .returning();
    await event(tx, actor, app.id, "applied", `Requested ₦${(input.requestedKobo / 100).toLocaleString("en-NG")}: ${purpose}`, onBehalf);
    return app;
  });
}

/* ---------------------------- offers ---------------------------- */

export type OfferInput = {
  amountKobo: number;
  ratePercent: string;
  tenureMonths: number;
  firstRepaymentPeriod: Period;
  conditions?: string;
  validDays?: number;
};

export async function makeOffer(actor: LoanActor, applicationId: number, input: OfferInput): Promise<LoanOffer> {
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) throw new DomainError("VALIDATION", "Enter the amount offered.", "amount");
  if (!isValidRatePercent(input.ratePercent)) throw new DomainError("VALIDATION", "Enter the interest rate in percent, e.g. 10.", "ratePercent");
  if (!Number.isInteger(input.tenureMonths) || input.tenureMonths < 1 || input.tenureMonths > 120) {
    throw new DomainError("VALIDATION", "Repayment period must be 1–120 months.", "tenureMonths");
  }
  if (!isPeriod(input.firstRepaymentPeriod)) throw new DomainError("VALIDATION", "Choose the first repayment month.", "firstRepaymentPeriod");
  if (input.firstRepaymentPeriod < periodOf(todayLagos())) {
    throw new DomainError("VALIDATION", "The first repayment month can't be in the past.", "firstRepaymentPeriod");
  }
  const terms = computeLoanTerms(input.amountKobo, input.ratePercent, input.tenureMonths);

  return db.transaction(async (tx) => {
    const app = await lockApplication(tx, applicationId);
    requireApprover(actor, app);
    if (!["submitted", "adjustment_requested", "offered"].includes(app.status)) {
      throw new DomainError("INVALID_STATUS", `An offer can't be made on an application that is ${app.status.replace("_", " ")}.`);
    }
    if (app.schemeId) {
      const [scheme] = await tx.select().from(loanSchemes).where(eq(loanSchemes.id, app.schemeId));
      if (scheme?.maxPerMemberKobo && input.amountKobo > scheme.maxPerMemberKobo) {
        throw new DomainError("OVER_SCHEME_MAX", "The amount is above this scheme's maximum per member.", "amount");
      }
    }
    const prev = await latestOffer(tx, app.id);
    if (prev && !prev.response) {
      // Revising an offer the member hasn't answered: the old one is withdrawn.
      await tx.insert(loanEvents).values({ applicationId: app.id, kind: "offer_withdrawn", note: `Offer v${prev.version} replaced`, actorUserId: actor.userId });
    }
    const [offer] = await tx
      .insert(loanOffers)
      .values({
        applicationId: app.id,
        version: (prev?.version ?? 0) + 1,
        amountKobo: input.amountKobo,
        ratePercent: input.ratePercent.trim(),
        interestKobo: terms.interestKobo,
        totalKobo: terms.totalKobo,
        tenureMonths: input.tenureMonths,
        instalmentKobo: terms.instalmentKobo,
        firstRepaymentPeriod: input.firstRepaymentPeriod,
        conditions: input.conditions?.trim() || null,
        validUntil: addDays(todayLagos(), input.validDays ?? OFFER_VALID_DAYS),
        offeredBy: actor.userId,
      })
      .returning();
    await tx.update(loanApplications).set({ status: "offered" }).where(eq(loanApplications.id, app.id));
    await event(
      tx,
      actor,
      app.id,
      "offered",
      `Offer v${offer.version}: ₦${(offer.amountKobo / 100).toLocaleString("en-NG")} at ${Number(offer.ratePercent)}% over ${offer.tenureMonths} months` +
        (offer.conditions ? ` — ${offer.conditions}` : ""),
      false,
    );
    return offer;
  });
}

export type OfferResponse =
  | { response: "accepted"; note?: string }
  | { response: "declined"; note?: string }
  | { response: "adjustment_requested"; note: string };

export async function respondToOffer(actor: LoanActor, applicationId: number, input: OfferResponse) {
  const note = input.note?.trim() || null;
  if (input.response === "adjustment_requested" && !note) {
    throw new DomainError("VALIDATION", "Say what you'd like changed (e.g. amount or number of months).", "note");
  }
  return db.transaction(async (tx) => {
    const app = await lockApplication(tx, applicationId);
    const { onBehalf } = memberSideAccess(actor, app.memberId);
    if (app.status !== "offered") throw new DomainError("INVALID_STATUS", "There is no offer waiting for a response.");
    const offer = await latestOffer(tx, app.id);
    if (!offer || offer.response) throw new DomainError("INVALID_STATUS", "There is no offer waiting for a response.");
    if (input.response === "accepted" && offer.validUntil < todayLagos()) {
      throw new DomainError("OFFER_EXPIRED", "This offer has expired. Ask the loan office for a new one.");
    }
    if (input.response === "accepted") {
      const [member] = await tx.select({ status: members.status }).from(members).where(eq(members.id, app.memberId));
      if (member.status !== "active") throw new DomainError("MEMBER_NOT_ACTIVE", "Only active members can accept a loan.");
    }
    await tx
      .update(loanOffers)
      .set({ response: input.response, responseNote: note, respondedBy: actor.userId, respondedOnBehalf: onBehalf, respondedAt: new Date() })
      .where(eq(loanOffers.id, offer.id));
    const status = input.response === "accepted" ? "accepted" : input.response === "declined" ? "declined" : "adjustment_requested";
    await tx.update(loanApplications).set({ status }).where(eq(loanApplications.id, app.id));
    await event(tx, actor, app.id, input.response === "adjustment_requested" ? "adjustment_requested" : input.response, note, onBehalf);
  });
}

export async function rejectApplication(actor: LoanActor, applicationId: number, reason: string) {
  const why = reason.trim();
  if (!why) throw new DomainError("VALIDATION", "Give a reason; the member will see it.", "reason");
  await db.transaction(async (tx) => {
    const app = await lockApplication(tx, applicationId);
    requireApprover(actor, app);
    if (!["submitted", "adjustment_requested", "offered"].includes(app.status)) {
      throw new DomainError("INVALID_STATUS", `An application that is ${app.status.replace("_", " ")} can't be rejected.`);
    }
    await tx.update(loanApplications).set({ status: "rejected" }).where(eq(loanApplications.id, app.id));
    await event(tx, actor, app.id, "rejected", why, false);
  });
}

export async function cancelApplication(actor: LoanActor, applicationId: number, reason: string) {
  await db.transaction(async (tx) => {
    const app = await lockApplication(tx, applicationId);
    const { onBehalf } = memberSideAccess(actor, app.memberId);
    if (!OPEN_STATUSES.includes(app.status)) {
      throw new DomainError("INVALID_STATUS", app.status === "disbursed" ? "The money has already been paid out; this loan can't be cancelled." : "This application is already closed.");
    }
    await tx.update(loanApplications).set({ status: "cancelled" }).where(eq(loanApplications.id, app.id));
    await event(tx, actor, app.id, "cancelled", reason.trim() || null, onBehalf);
  });
}

/* ---------------------------- queries ---------------------------- */

const STAFF_QUEUES: Record<string, LoanApplication["status"][]> = {
  action: ["submitted", "adjustment_requested"],
  offered: ["offered"],
  accepted: ["accepted"],
  closed: ["declined", "rejected", "cancelled", "disbursed"],
};

export async function listApplications(opts: { queue?: keyof typeof STAFF_QUEUES | "all"; memberId?: number; schemeId?: number } = {}) {
  const conds = [];
  if (opts.queue && opts.queue !== "all") conds.push(inArray(loanApplications.status, STAFF_QUEUES[opts.queue]));
  if (opts.memberId) conds.push(eq(loanApplications.memberId, opts.memberId));
  if (opts.schemeId) conds.push(eq(loanApplications.schemeId, opts.schemeId));
  const rows = await db
    .select({
      app: loanApplications,
      memberNo: members.memberNo,
      memberName: members.fullName,
      schemeName: loanSchemes.name,
      offer: sql<{ amount_kobo: number; tenure_months: number; total_kobo: number; instalment_kobo: number; valid_until: string; version: number } | null>`(
        select row_to_json(o) from (select amount_kobo, tenure_months, total_kobo, instalment_kobo, valid_until, version
          from loan_offers where application_id = ${loanApplications.id} order by version desc limit 1) o)`,
    })
    .from(loanApplications)
    .innerJoin(members, eq(members.id, loanApplications.memberId))
    .leftJoin(loanSchemes, eq(loanSchemes.id, loanApplications.schemeId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(loanApplications.updatedAt))
    .limit(300);
  return rows;
}

export async function queueCounts() {
  const rows = await db
    .select({ status: loanApplications.status, n: sql<number>`count(*)::int` })
    .from(loanApplications)
    .groupBy(loanApplications.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const sum = (k: string) => STAFF_QUEUES[k].reduce((s, st) => s + (by[st] ?? 0), 0);
  return { action: sum("action"), offered: sum("offered"), accepted: sum("accepted"), closed: sum("closed") };
}

export async function getApplicationDetail(id: number) {
  const [row] = await db
    .select({ app: loanApplications, member: members, scheme: loanSchemes })
    .from(loanApplications)
    .innerJoin(members, eq(members.id, loanApplications.memberId))
    .leftJoin(loanSchemes, eq(loanSchemes.id, loanApplications.schemeId))
    .where(eq(loanApplications.id, id));
  if (!row) return null;
  const [offers, events] = await Promise.all([
    db.select().from(loanOffers).where(eq(loanOffers.applicationId, id)).orderBy(desc(loanOffers.version)),
    db
      .select({ e: loanEvents, actorName: users.displayName, actorMemberId: users.memberId })
      .from(loanEvents)
      .leftJoin(users, eq(users.id, loanEvents.actorUserId))
      .where(eq(loanEvents.applicationId, id))
      .orderBy(desc(loanEvents.id)),
  ]);
  return { ...row, offers, events, currentOffer: offers[0] ?? null };
}

/** What an approver needs to see before deciding. */
export async function eligibilitySnapshot(memberId: number, excludeApplicationId?: number) {
  const [member] = await db.select().from(members).where(eq(members.id, memberId));
  const savingsKobo = await getSavingsBalance(memberId);
  const others = await db
    .select({ id: loanApplications.id, status: loanApplications.status, loanType: loanApplications.loanType, requestedKobo: loanApplications.requestedKobo, createdAt: loanApplications.createdAt })
    .from(loanApplications)
    .where(eq(loanApplications.memberId, memberId))
    .orderBy(desc(loanApplications.id));
  const joined = new Date(`${member.dateJoined}T00:00:00Z`);
  const now = new Date(`${todayLagos()}T00:00:00Z`);
  const monthsOfMembership = (now.getUTCFullYear() - joined.getUTCFullYear()) * 12 + (now.getUTCMonth() - joined.getUTCMonth());
  return {
    savingsKobo,
    monthsOfMembership,
    memberStatus: member.status,
    otherApplications: others.filter((o) => o.id !== excludeApplicationId),
    // Active loan balances arrive with the payout phase.
  };
}

/** Default first repayment month for a new offer: next month. */
export function defaultFirstRepayment(): Period {
  return addMonths(periodOf(todayLagos()), 1);
}
