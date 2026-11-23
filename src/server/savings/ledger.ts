/**
 * Savings ledger. Rows are only ever inserted (the database refuses updates
 * and deletes); a balance is always the sum of a member's rows.
 *
 * Earnings (the cooperative's "interest") are NOT ledger rows: they are
 * computed from the ledger (see lib/earnings.ts) and paid via a yearly payout.
 */
import { and, asc, desc, eq, gte, lt, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbOrTx } from "@/db";
import { earningRates, members, savingsTransactions, users, type SavingsTxn } from "@/db/schema";
import { computeYearEarnings, type RateTable, type YearEarnings } from "@/lib/earnings";
import { todayLagos } from "@/lib/format";
import { isPeriod, makePeriod, periodOf, type Period } from "@/lib/period";
import { writeAudit, type Actor } from "../audit";
import { DomainError, isUniqueViolation } from "../errors";

/* ---------------------------- reads ---------------------------- */

export async function getSavingsBalance(memberId: number, tx: DbOrTx = db): Promise<number> {
  const [r] = await tx
    .select({ total: sum(savingsTransactions.amountKobo) })
    .from(savingsTransactions)
    .where(eq(savingsTransactions.memberId, memberId));
  return Number(r.total ?? 0);
}

export async function getRates(tx: DbOrTx = db): Promise<RateTable> {
  return tx.select({ effectiveFrom: earningRates.effectiveFrom, monthlyRate: earningRates.monthlyRate }).from(earningRates);
}

const original = alias(savingsTransactions, "original");

export type LedgerLine = SavingsTxn & { createdByName: string | null; reversedById: number | null; originalType: SavingsTxn["type"] | null };

export async function listSavingsTransactions(memberId: number, opts: { year?: number } = {}): Promise<LedgerLine[]> {
  const reversal = alias(savingsTransactions, "reversal");
  const conds = [eq(savingsTransactions.memberId, memberId)];
  if (opts.year) {
    conds.push(gte(savingsTransactions.period, makePeriod(opts.year, 1)), lt(savingsTransactions.period, makePeriod(opts.year + 1, 1)));
  }
  const rows = await db
    .select({
      t: savingsTransactions,
      createdByName: users.displayName,
      reversedById: reversal.id,
      originalType: original.type,
    })
    .from(savingsTransactions)
    .leftJoin(users, eq(users.id, savingsTransactions.createdBy))
    .leftJoin(reversal, eq(reversal.reversesId, savingsTransactions.id))
    .leftJoin(original, eq(original.id, savingsTransactions.reversesId))
    .where(and(...conds))
    .orderBy(desc(savingsTransactions.period), desc(savingsTransactions.id));
  return rows.map((r) => ({ ...r.t, createdByName: r.createdByName, reversedById: r.reversedById, originalType: r.originalType }));
}

export type PassbookYear = YearEarnings & {
  contributionsKobo: number;
  withdrawalsKobo: number;
  adjustmentsKobo: number;
  /** True for the current year: earnings are to date, not final. */
  inProgress: boolean;
};

/**
 * One row per year, like the personal account sheet: opening, contributions,
 * withdrawals, adjustments, closing, and the year's computed earnings.
 */
export async function getPassbook(memberId: number, tx: DbOrTx = db): Promise<PassbookYear[]> {
  const rows = await tx
    .select({
      period: savingsTransactions.period,
      // A reversal counts under the type of the row it cancels.
      kind: sql<SavingsTxn["type"]>`coalesce(${original.type}, ${savingsTransactions.type})`,
      amount: sql<string>`sum(${savingsTransactions.amountKobo})`,
    })
    .from(savingsTransactions)
    .leftJoin(original, eq(original.id, savingsTransactions.reversesId))
    .where(eq(savingsTransactions.memberId, memberId))
    .groupBy(savingsTransactions.period, sql`2`)
    .orderBy(asc(savingsTransactions.period));
  if (!rows.length) return [];

  const movements = new Map<Period, number>();
  for (const r of rows) movements.set(r.period, (movements.get(r.period) ?? 0) + Number(r.amount));

  const rates = await getRates(tx);
  const today = periodOf(todayLagos());
  const firstYear = Number(rows[0].period.slice(0, 4));
  const currentYear = Number(today.slice(0, 4));
  const lastYear = Math.max(currentYear, Number(rows.at(-1)!.period.slice(0, 4)));

  const out: PassbookYear[] = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const inProgress = y === currentYear;
    const e = computeYearEarnings(movements, y, rates, inProgress ? Number(today.slice(5)) : 12);
    const inYear = rows.filter((r) => r.period.startsWith(`${y}-`));
    const total = (kinds: string[]) => inYear.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + Number(r.amount), 0);
    // Movements after the current month (e.g. a future-dated period) still belong to the closing figure.
    const closing = e.openingKobo + inYear.reduce((s, r) => s + Number(r.amount), 0);
    out.push({
      ...e,
      closingKobo: closing,
      contributionsKobo: total(["contribution", "migrated_opening"]),
      withdrawalsKobo: total(["withdrawal"]),
      adjustmentsKobo: total(["adjustment"]),
      inProgress,
    });
  }
  return out.reverse();
}

/* ---------------------------- writes ---------------------------- */

/** Used by the import commit. Caller holds the transaction and has validated the row. */
export async function insertImportContributions(
  tx: DbOrTx,
  actor: Actor,
  lines: { memberId: number; amountKobo: number; importRowId: number }[],
  batch: { id: number; period: Period },
) {
  if (!lines.length) return;
  await tx.insert(savingsTransactions).values(
    lines.map((l) => ({
      memberId: l.memberId,
      period: batch.period,
      txnDate: todayLagos(),
      type: "contribution" as const,
      amountKobo: l.amountKobo,
      source: "import" as const,
      batchId: batch.id,
      importRowId: l.importRowId,
      importKey: `${l.memberId}:${batch.period}`,
      narration: "Payroll deduction",
      createdBy: actor.userId,
    })),
  );
}

export type ManualEntryInput = {
  memberId: number;
  type: "contribution" | "withdrawal" | "adjustment";
  /** Always positive; direction comes from type (and `direction` for adjustments). */
  amountKobo: number;
  direction?: "credit" | "debit";
  period: Period;
  txnDate?: string;
  narration: string;
};

export async function recordManualEntry(actor: Actor, input: ManualEntryInput): Promise<SavingsTxn> {
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) {
    throw new DomainError("VALIDATION", "Enter an amount greater than zero.", "amount");
  }
  if (!isPeriod(input.period)) throw new DomainError("VALIDATION", "Choose the month this belongs to.", "period");
  const narration = input.narration.trim();
  if (!narration) throw new DomainError("VALIDATION", "Add a description (e.g. receipt or transfer reference).", "narration");
  const txnDate = input.txnDate || todayLagos();
  if (txnDate > todayLagos()) throw new DomainError("VALIDATION", "The date can't be in the future.", "txnDate");

  const sign = input.type === "withdrawal" || (input.type === "adjustment" && input.direction === "debit") ? -1 : 1;
  const amount = sign * input.amountKobo;

  return db.transaction(async (tx) => {
    // Lock the member so concurrent withdrawals can't both pass the balance check.
    const [member] = await tx.select().from(members).where(eq(members.id, input.memberId)).for("update");
    if (!member) throw new DomainError("NOT_FOUND", "Member not found.");
    if (member.status === "exited" && input.type === "contribution") {
      throw new DomainError("MEMBER_EXITED", "Exited members can't receive new contributions.");
    }
    if (amount < 0) {
      const balance = await getSavingsBalance(member.id, tx);
      if (balance + amount < 0) {
        throw new DomainError(
          "INSUFFICIENT_BALANCE",
          `This would take the savings balance below zero (balance is ₦${(balance / 100).toLocaleString("en-NG")}).`,
          "amount",
        );
      }
    }
    const [row] = await tx
      .insert(savingsTransactions)
      .values({
        memberId: member.id,
        period: input.period,
        txnDate,
        type: input.type,
        amountKobo: amount,
        source: "manual",
        narration,
        createdBy: actor.userId,
      })
      .returning();
    await writeAudit(tx, actor, {
      action: `savings.${input.type}`,
      entityType: "savings_txn",
      entityId: row.id,
      after: { memberId: member.id, period: row.period, amountKobo: row.amountKobo, narration },
    });
    return row;
  });
}

export async function reverseSavingsTransaction(actor: Actor, txnId: number, reason: string): Promise<SavingsTxn> {
  const why = reason.trim();
  if (!why) throw new DomainError("VALIDATION", "Give a reason for the reversal.", "reason");
  try {
    return await db.transaction(async (tx) => {
      const [orig] = await tx.select().from(savingsTransactions).where(eq(savingsTransactions.id, txnId));
      if (!orig) throw new DomainError("NOT_FOUND", "Transaction not found.");
      if (orig.type === "reversal") throw new DomainError("INVALID", "A reversal can't itself be reversed.");
      await tx.select({ id: members.id }).from(members).where(eq(members.id, orig.memberId)).for("update");
      const [existing] = await tx
        .select({ id: savingsTransactions.id })
        .from(savingsTransactions)
        .where(eq(savingsTransactions.reversesId, orig.id));
      if (existing) throw new DomainError("ALREADY_REVERSED", "This transaction has already been reversed.");
      if (orig.amountKobo > 0) {
        const balance = await getSavingsBalance(orig.memberId, tx);
        if (balance - orig.amountKobo < 0) {
          throw new DomainError("INSUFFICIENT_BALANCE", "Reversing this would take the savings balance below zero.");
        }
      }
      const [row] = await tx
        .insert(savingsTransactions)
        .values({
          memberId: orig.memberId,
          period: orig.period,
          txnDate: todayLagos(),
          type: "reversal",
          amountKobo: -orig.amountKobo,
          source: "manual",
          reversesId: orig.id,
          narration: `Reversal: ${why}`,
          createdBy: actor.userId,
        })
        .returning();
      await writeAudit(tx, actor, {
        action: "savings.reversal",
        entityType: "savings_txn",
        entityId: orig.id,
        after: { reversalId: row.id, amountKobo: row.amountKobo, reason: why },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("ALREADY_REVERSED", "This transaction has already been reversed.");
    throw err;
  }
}
