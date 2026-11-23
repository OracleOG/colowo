import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { importRows, savingsTransactions } from "@/db/schema";
import { SYSTEM } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { parseKadunaPayroll } from "@/server/imports/kaduna-payroll";
import { buildKadunaPayrollFile, type SampleRow } from "@/server/imports/sample-file";
import {
  cancelBatch,
  commitBatch,
  correctRow,
  getBatchSummary,
  postHeldBackRow,
  setRowSkipped,
  uploadBatch,
} from "@/server/imports/service";
import { changeMemberStatus, createMember } from "@/server/members";
import { getPassbook, getSavingsBalance, recordManualEntry, reverseSavingsTransaction } from "@/server/savings/ledger";
import { resetDb } from "./helpers";

const actor = SYSTEM;
const ids: Record<string, number> = {};

beforeAll(async () => {
  await resetDb();
  const mk = async (key: string, emp: string, extra: Record<string, unknown> = {}) => {
    const m = await createMember(actor, { fullName: `Import ${key}`, employeeNo: emp, dateJoined: "2020-01-01", ...extra });
    ids[key] = m.id;
  };
  await mk("a", "EMP0000001");
  await mk("b", "EMP0000002");
  await mk("c", "EMP0000003", { verificationNo: "8612000003" });
  await mk("gone", "EMP0000004");
  await changeMemberStatus(actor, ids.gone, { status: "exited", reason: "Left", dateExited: "2025-12-31" });
});
afterAll(() => pool.end());

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);
}

const file = (rows: SampleRow[], monthLabel = "May 2026", extra = {}) => buildKadunaPayrollFile({ monthLabel, rows, ...extra });

describe("parser", () => {
  it("reads the payroll layout and its control totals", async () => {
    const parsed = await parseKadunaPayroll(
      await file([
        { employmentNo: "EMP0000001", verificationNo: "8612000001", amount: 5000 },
        { employmentNo: "EMP0000002", amount: "12,000" },
      ]),
    );
    expect(parsed.period).toBe("2026-05");
    expect(parsed.rows.map((r) => [r.employmentNo, r.amountKobo, r.section])).toEqual([
      ["EMP0000001", 500000, "HEALTH"],
      ["EMP0000002", 1200000, "HEALTH"],
    ]);
    expect(parsed.controlCount).toBe(2);
    expect(parsed.controlTotalKobo).toBe(1700000);
    expect(parsed.structureErrors).toEqual([]);
  });

  it("reports a file whose rows don't add up to its Grand Total", async () => {
    const parsed = await parseKadunaPayroll(
      await file([{ employmentNo: "EMP0000001", amount: 5000 }], "May 2026", { grandTotal: { count: 2, amount: 10000 } }),
    );
    expect(parsed.structureErrors).toHaveLength(2);
  });

  it("rejects a file that isn't a payroll workbook", async () => {
    await expect(parseKadunaPayroll(Buffer.from("not excel"))).rejects.toThrow(/could not be read/);
  });
});

describe("import workflow", () => {
  let batchId: number;

  it("stages a file, flags exceptions, and posts nothing yet", async () => {
    batchId = await uploadBatch(actor, {
      period: "2026-05",
      fileName: "may.xlsx",
      bytes: await file([
        { employmentNo: "EMP0000001", amount: 5000 },
        { employmentNo: "EMP0000002", amount: 10000 },
        { employmentNo: "EMP9999999", verificationNo: "8612000003", amount: 7000 }, // unknown; suggests c
        { employmentNo: "EMP0000004", amount: 5000 }, // exited
      ]),
    });
    const s = (await getBatchSummary(batchId))!;
    expect(s.counts).toMatchObject({ total: 4, ok: 2, error: 2 });
    expect(s.toPost).toEqual({ count: 2, totalKobo: 1500000 });
    expect(s.errorsByCode.map((e) => e.code).sort()).toEqual(["MEMBER_EXITED", "UNKNOWN_MEMBER"]);
    expect(await getSavingsBalance(ids.a)).toBe(0);

    const [unknown] = await db.select().from(importRows).where(eq(importRows.employmentNoRaw, "EMP9999999"));
    expect(unknown.suggestedMemberId).toBe(ids.c);
  });

  it("refuses the same file again while it's in review", async () => {
    const bytes = await file([
      { employmentNo: "EMP0000001", amount: 5000 },
      { employmentNo: "EMP0000002", amount: 10000 },
      { employmentNo: "EMP9999999", verificationNo: "8612000003", amount: 7000 },
      { employmentNo: "EMP0000004", amount: 5000 },
    ]);
    // ExcelJS writes a timestamp, so build-identical bytes aren't guaranteed: re-read the stored file instead.
    const { getBatchFile } = await import("@/server/imports/service");
    const stored = (await getBatchFile(batchId))!;
    await expectCode(uploadBatch(actor, { period: "2026-05", fileName: "again.xlsx", bytes: Buffer.from(stored.content) }), "FILE_IN_REVIEW");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("lets the officer correct a row (re-validated) and skip another", async () => {
    const rows = await db.select().from(importRows).where(eq(importRows.batchId, batchId));
    const unknown = rows.find((r) => r.employmentNoRaw === "EMP9999999")!;
    const exited = rows.find((r) => r.employmentNoRaw === "EMP0000004")!;
    await correctRow(actor, unknown.id, { employmentNo: "emp0000003", amount: "7,000", note: "Wrong number on bank file" });
    await setRowSkipped(actor, exited.id, true, "Exited — refund to be arranged");
    const s = (await getBatchSummary(batchId))!;
    expect(s.counts).toMatchObject({ ok: 3, error: 0, skipped: 1 });
    expect(s.toPost).toEqual({ count: 3, totalKobo: 2200000 });
  });

  it("refuses to commit if the confirmed numbers are stale", async () => {
    await expectCode(commitBatch(actor, batchId, { count: 2, totalKobo: 1500000 }), "STALE");
  });

  it("commits in one go and the batch reconciles with the ledger", async () => {
    const r = await commitBatch(actor, batchId, { count: 3, totalKobo: 2200000 });
    expect(r).toEqual({ count: 3, totalKobo: 2200000 });
    const posted = await db.select().from(savingsTransactions).where(eq(savingsTransactions.batchId, batchId));
    expect(posted.reduce((s, t) => s + t.amountKobo, 0)).toBe(2200000);
    expect(posted.every((t) => t.period === "2026-05" && t.type === "contribution")).toBe(true);
    expect(await getSavingsBalance(ids.c)).toBe(700000);
    const s = (await getBatchSummary(batchId))!;
    expect(s.batch).toMatchObject({ status: "committed", postedCount: 3, postedTotalKobo: 2200000 });
    await expectCode(commitBatch(actor, batchId, { count: 0, totalKobo: 0 }), "BATCH_CLOSED");
  });

  it("refuses the committed file and flags members already posted in a second file", async () => {
    const stored = (await (await import("@/server/imports/service")).getBatchFile(batchId))!;
    await expectCode(uploadBatch(actor, { period: "2026-05", fileName: "dup.xlsx", bytes: Buffer.from(stored.content) }), "FILE_ALREADY_COMMITTED");

    const second = await uploadBatch(actor, {
      period: "2026-05",
      fileName: "may-supplement.xlsx",
      bytes: await file([{ employmentNo: "EMP0000001", amount: 5000 }]),
    });
    const s = (await getBatchSummary(second))!;
    expect(s.errorsByCode).toEqual([{ code: "ALREADY_POSTED", count: 1, totalKobo: 500000 }]);
    expect(s.otherCommittedBatchId).toBe(batchId);
    await cancelBatch(actor, second, "Supplement duplicates May");
  });

  it("blocks a file whose month doesn't match the chosen period", async () => {
    const id = await uploadBatch(actor, {
      period: "2026-06",
      fileName: "wrong-month.xlsx",
      bytes: await file([{ employmentNo: "EMP0000001", amount: 5000 }], "May 2026"),
    });
    const s = (await getBatchSummary(id))!;
    expect(s.batch.structureErrors[0]).toMatch(/May 2026 but you chose June 2026/);
    await expectCode(commitBatch(actor, id, { count: 1, totalKobo: 500000 }), "STRUCTURE_ERROR");
    await cancelBatch(actor, id, "Wrong month");
  });

  it("can post a held-back row after commit, once it's fixed", async () => {
    const id = await uploadBatch(actor, {
      period: "2026-06",
      fileName: "june.xlsx",
      bytes: await file(
        [
          { employmentNo: "EMP0000001", amount: 5000 },
          { employmentNo: "EMP0000002", amount: "ten thousand" },
        ],
        "June 2026",
        { grandTotal: { count: 2, amount: 5000 } },
      ),
    });
    await commitBatch(actor, id, { count: 1, totalKobo: 500000 });
    const [bad] = await db.select().from(importRows).where(eq(importRows.amountRaw, "ten thousand"));
    await expectCode(postHeldBackRow(actor, bad.id), "ROW_INVALID");
    await correctRow(actor, bad.id, { employmentNo: "EMP0000002", amount: "10000" });
    await postHeldBackRow(actor, bad.id);
    const s = (await getBatchSummary(id))!;
    expect(s.batch).toMatchObject({ postedCount: 2, postedTotalKobo: 1500000 });
    expect(await getSavingsBalance(ids.b)).toBe(2000000);
  });
});

describe("savings ledger", () => {
  it("records manual entries and blocks withdrawals beyond the balance", async () => {
    await recordManualEntry(actor, { memberId: ids.a, type: "contribution", amountKobo: 300000, period: "2026-04", narration: "Cash, receipt 0042" });
    const bal = await getSavingsBalance(ids.a); // 5000 + 5000 + 3000
    expect(bal).toBe(1300000);
    await expectCode(
      recordManualEntry(actor, { memberId: ids.a, type: "withdrawal", amountKobo: bal + 1, period: "2026-06", narration: "Too much" }),
      "INSUFFICIENT_BALANCE",
    );
    await recordManualEntry(actor, { memberId: ids.a, type: "withdrawal", amountKobo: 100000, period: "2026-06", narration: "Approved withdrawal" });
    expect(await getSavingsBalance(ids.a)).toBe(1200000);
  });

  it("reverses a transaction exactly once, and never edits rows", async () => {
    const [t] = await db.select().from(savingsTransactions).where(eq(savingsTransactions.memberId, ids.c));
    await reverseSavingsTransaction(actor, t.id, "Posted to wrong member");
    expect(await getSavingsBalance(ids.c)).toBe(0);
    await expectCode(reverseSavingsTransaction(actor, t.id, "again"), "ALREADY_REVERSED");
    await expect(db.update(savingsTransactions).set({ amountKobo: 1 }).where(eq(savingsTransactions.id, t.id))).rejects.toThrow();
    await expect(db.delete(savingsTransactions).where(eq(savingsTransactions.id, t.id))).rejects.toThrow();
  });

  it("rejects a reversal that doesn't exactly cancel the original (database rule)", async () => {
    const [t] = await db.select().from(savingsTransactions).where(eq(savingsTransactions.memberId, ids.b)).limit(1);
    await expect(
      db.insert(savingsTransactions).values({ memberId: ids.b, period: t.period, txnDate: "2026-06-30", type: "reversal", amountKobo: -1, source: "manual", reversesId: t.id }),
    ).rejects.toThrow();
  });

  it("builds a passbook by year with earnings", async () => {
    const book = await getPassbook(ids.a);
    const y2026 = book.find((y) => y.year === 2026)!;
    expect(y2026).toMatchObject({ openingKobo: 0, contributionsKobo: 1300000, withdrawalsKobo: -100000, closingKobo: 1200000 });
    expect(y2026.earningsKobo).toBeGreaterThan(0);
  });
});
