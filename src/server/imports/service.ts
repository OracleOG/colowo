/**
 * Deduction import workflow:
 *
 *   upload → parse → stage rows → validate → (officer corrects / skips) → commit
 *
 * Nothing reaches the savings ledger until commit, which posts every ok/warning
 * row in one transaction. Error rows stay on the batch and can be fixed and
 * posted later, still linked to the batch for the audit trail.
 */
import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { importBatches, importRows, members, savingsTransactions, storedFiles, users, type ImportRow } from "@/db/schema";
import { parseAmountToKobo } from "@/lib/money";
import { normalizeEmployeeNo } from "@/lib/normalize";
import { formatPeriod, isPeriod, makePeriod, periodParts, type Period } from "@/lib/period";
import { writeAudit, type Actor } from "../audit";
import { DomainError, isUniqueViolation } from "../errors";
import { insertImportContributions } from "../savings/ledger";
import { settings } from "../settings";
import { allocateDeduction } from "./allocation";
import { FileFormatError, FORMAT_ID, parseKadunaPayroll } from "./kaduna-payroll";
import { median, validateRows, type MemberLite, type RowToValidate } from "./validate";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/* ---------------------------- upload ---------------------------- */

export async function uploadBatch(
  actor: Actor,
  input: { period: Period; fileName: string; bytes: Buffer },
): Promise<number> {
  if (!isPeriod(input.period)) throw new DomainError("VALIDATION", "Choose the month this file is for.", "period");
  if (!input.bytes.length) throw new DomainError("VALIDATION", "Choose a file to upload.", "file");
  if (input.bytes.length > settings.importMaxBytes) {
    throw new DomainError("VALIDATION", "That file is too large (limit 5 MB).", "file");
  }
  const hash = createHash("sha256").update(input.bytes).digest("hex");

  const [same] = await db
    .select({ id: importBatches.id, status: importBatches.status, period: importBatches.period })
    .from(importBatches)
    .where(and(eq(importBatches.fileHash, hash), ne(importBatches.status, "cancelled")))
    .limit(1);
  if (same) {
    throw new DomainError(
      same.status === "committed" ? "FILE_ALREADY_COMMITTED" : "FILE_IN_REVIEW",
      same.status === "committed"
        ? `This exact file was already committed (batch #${same.id}, ${formatPeriod(same.period)}).`
        : `This exact file is already being reviewed in batch #${same.id}.`,
      "file",
      { batchId: same.id },
    );
  }

  let parsed;
  try {
    parsed = await parseKadunaPayroll(input.bytes);
  } catch (err) {
    if (err instanceof FileFormatError) throw new DomainError("FILE_UNREADABLE", err.message, "file");
    throw err;
  }

  const structureErrors = [...parsed.structureErrors];
  if (parsed.period && parsed.period !== input.period) {
    structureErrors.unshift(
      `The file says ${formatPeriod(parsed.period)} but you chose ${formatPeriod(input.period)}. Cancel and upload again with the right month.`,
    );
  }

  return db.transaction(async (tx) => {
    const [file] = await tx
      .insert(storedFiles)
      .values({
        sha256: hash,
        fileName: input.fileName,
        contentType: XLSX_TYPE,
        sizeBytes: input.bytes.length,
        content: input.bytes,
        uploadedBy: actor.userId,
      })
      .returning({ id: storedFiles.id });

    const [batch] = await tx
      .insert(importBatches)
      .values({
        period: input.period,
        format: FORMAT_ID,
        fileId: file.id,
        fileName: input.fileName,
        fileHash: hash,
        filePeriodLabel: parsed.periodLabel,
        structureErrors,
        notices: parsed.notices,
        controlCount: parsed.controlCount,
        controlTotalKobo: parsed.controlTotalKobo,
        parsedCount: parsed.rows.length,
        parsedTotalKobo: parsed.rows.reduce((s, r) => s + (r.amountKobo ?? 0), 0),
        uploadedBy: actor.userId,
      })
      .returning();

    for (let i = 0; i < parsed.rows.length; i += 500) {
      await tx.insert(importRows).values(
        parsed.rows.slice(i, i + 500).map((r) => ({
          batchId: batch.id,
          rowNumber: r.rowNumber,
          raw: r.raw,
          section: r.section,
          employmentNoRaw: r.employmentNoRaw,
          verificationNoRaw: r.verificationNoRaw,
          nameRaw: r.nameRaw,
          amountRaw: r.amountRaw,
          ytdKobo: r.ytdKobo,
          employmentNo: r.employmentNo,
          amountKobo: r.amountKobo,
          status: "error" as const, // replaced by validation below
        })),
      );
    }
    await validateBatch(tx, batch.id);
    await writeAudit(tx, actor, {
      action: "import.upload",
      entityType: "import_batch",
      entityId: batch.id,
      after: {
        period: input.period,
        fileName: input.fileName,
        rows: parsed.rows.length,
        totalKobo: batch.parsedTotalKobo,
        structureErrors,
        notices: parsed.notices,
      },
    });
    return batch.id;
  });
}

/* ---------------------------- validation ---------------------------- */

async function buildContext(tx: DbOrTx, period: Period) {
  const all = await tx
    .select({
      id: members.id,
      memberNo: members.memberNo,
      fullName: members.fullName,
      status: members.status,
      employeeNo: members.employeeNo,
      verificationNo: members.verificationNo,
    })
    .from(members);
  const byEmployeeNo = new Map<string, MemberLite[]>();
  const byVerificationNo = new Map<string, MemberLite>();
  for (const m of all) {
    const e = normalizeEmployeeNo(m.employeeNo);
    if (e) byEmployeeNo.set(e, [...(byEmployeeNo.get(e) ?? []), m]);
    const v = normalizeEmployeeNo(m.verificationNo);
    if (v && m.status !== "exited") byVerificationNo.set(v, m);
  }

  const posted = await tx
    .select({ memberId: savingsTransactions.memberId })
    .from(savingsTransactions)
    .where(and(eq(savingsTransactions.period, period), sql`${savingsTransactions.importKey} is not null`));

  // Usual deduction: median of each member's last 6 contributions before this month.
  const recent = await tx.execute<{ member_id: string; amount_kobo: string }>(sql`
    select member_id, amount_kobo from (
      select member_id, amount_kobo,
             row_number() over (partition by member_id order by period desc) as rn
      from savings_transactions
      where type = 'contribution' and period < ${period}
    ) x where rn <= 6`);
  const amounts = new Map<number, number[]>();
  for (const r of recent.rows) {
    const id = Number(r.member_id);
    amounts.set(id, [...(amounts.get(id) ?? []), Number(r.amount_kobo)]);
  }
  const baselineKobo = new Map<number, number>();
  for (const [id, list] of amounts) baselineKobo.set(id, median(list)!);

  let postedThisYearKobo: Map<number, number> | null = null;
  if (settings.importYtdCheck) {
    const { year } = periodParts(period);
    const rows = await tx
      .select({ memberId: savingsTransactions.memberId, total: sql<string>`sum(${savingsTransactions.amountKobo})` })
      .from(savingsTransactions)
      .where(
        and(
          sql`${savingsTransactions.period} >= ${makePeriod(year, 1)}`,
          lt(savingsTransactions.period, period),
          inArray(savingsTransactions.type, ["contribution", "reversal"]),
        ),
      )
      .groupBy(savingsTransactions.memberId);
    postedThisYearKobo = new Map(rows.map((r) => [r.memberId, Number(r.total)]));
  }

  return {
    byEmployeeNo,
    byVerificationNo,
    alreadyPosted: new Set(posted.map((p) => p.memberId)),
    baselineKobo,
    postedThisYearKobo,
    anomalyThreshold: settings.importAnomalyThreshold,
    suspendedPolicy: settings.importSuspendedPolicy,
  };
}

/** Re-check every not-yet-posted row of a batch against the current register and ledger. */
export async function validateBatch(tx: DbOrTx, batchId: number) {
  const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId));
  const rows = await tx
    .select()
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), isNull(importRows.postedAt)));
  if (!rows.length) return;

  const ctx = await buildContext(tx, batch.period);
  const input: RowToValidate[] = rows.map((r) => ({
    key: r.id,
    employmentNo: r.employmentNo,
    verificationNo: r.verificationNoRaw,
    amountRaw: r.amountRaw,
    amountKobo: r.amountKobo,
    ytdKobo: r.ytdKobo,
    skipped: r.resolution === "skipped",
  }));
  const results = validateRows(input, ctx);

  const payload = rows.map((r) => {
    const v = results.get(r.id)!;
    return {
      id: r.id,
      status: v.status,
      error_code: v.errorCode,
      warnings: v.warnings,
      message: v.message,
      member_id: v.memberId,
      suggested_member_id: v.suggestedMemberId,
    };
  });
  await tx.execute(sql`
    update import_rows r set
      status = v.status, error_code = v.error_code, warnings = v.warnings, message = v.message,
      member_id = v.member_id, suggested_member_id = v.suggested_member_id, updated_at = now()
    from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as v(
      id bigint, status import_row_status, error_code text, warnings jsonb, message text,
      member_id bigint, suggested_member_id bigint)
    where r.id = v.id`);
}

/* ---------------------------- officer actions ---------------------------- */

async function lockRowAndBatch(tx: DbOrTx, rowId: number) {
  const [row] = await tx.select().from(importRows).where(eq(importRows.id, rowId)).for("update");
  if (!row) throw new DomainError("NOT_FOUND", "Row not found.");
  const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, row.batchId)).for("update");
  if (batch.status === "cancelled") throw new DomainError("BATCH_CLOSED", "This import was cancelled.");
  if (row.postedAt) throw new DomainError("ROW_POSTED", "This row has already been posted to the ledger.");
  return { row, batch };
}

export async function correctRow(
  actor: Actor,
  rowId: number,
  input: { employmentNo: string; amount: string; note?: string },
) {
  const employmentNo = normalizeEmployeeNo(input.employmentNo);
  if (!employmentNo) throw new DomainError("VALIDATION", "Enter the employment number.", "employmentNo");
  const amount = parseAmountToKobo(input.amount);
  if (!amount.ok || amount.kobo <= 0) throw new DomainError("VALIDATION", "Enter a valid amount above zero.", "amount");

  await db.transaction(async (tx) => {
    const { row } = await lockRowAndBatch(tx, rowId);
    if (row.employmentNo === employmentNo && row.amountKobo === amount.kobo) return;
    await tx
      .update(importRows)
      .set({
        employmentNo,
        amountKobo: amount.kobo,
        resolution: "corrected",
        resolvedBy: actor.userId,
        note: input.note?.trim() || row.note,
      })
      .where(eq(importRows.id, rowId));
    await writeAudit(tx, actor, {
      action: "import.row_correct",
      entityType: "import_row",
      entityId: rowId,
      before: { employmentNo: row.employmentNo, amountKobo: row.amountKobo },
      after: { employmentNo, amountKobo: amount.kobo, batchId: row.batchId, rowNumber: row.rowNumber, note: input.note },
    });
    await validateBatch(tx, row.batchId);
  });
}

export async function setRowSkipped(actor: Actor, rowId: number, skipped: boolean, note?: string) {
  await db.transaction(async (tx) => {
    const { row } = await lockRowAndBatch(tx, rowId);
    const original = { employmentNo: normalizeEmployeeNo(row.employmentNoRaw), amountKobo: parseAmountToKobo(row.amountRaw) };
    const isCorrected =
      row.employmentNo !== original.employmentNo || !original.amountKobo.ok || row.amountKobo !== original.amountKobo.kobo;
    await tx
      .update(importRows)
      .set({
        resolution: skipped ? "skipped" : isCorrected ? "corrected" : "none",
        resolvedBy: actor.userId,
        note: note?.trim() || row.note,
      })
      .where(eq(importRows.id, rowId));
    await writeAudit(tx, actor, {
      action: skipped ? "import.row_skip" : "import.row_unskip",
      entityType: "import_row",
      entityId: rowId,
      after: { batchId: row.batchId, rowNumber: row.rowNumber, note },
    });
    await validateBatch(tx, row.batchId);
  });
}

/* ---------------------------- commit ---------------------------- */

function postableRows(rows: ImportRow[]) {
  return rows.filter(
    (r) => !r.postedAt && r.resolution !== "skipped" && (r.status === "ok" || r.status === "warning") && r.memberId && r.amountKobo,
  );
}

/** Serialise everything that posts bank deductions for one month. */
async function lockPeriod(tx: DbOrTx, period: Period) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"import:" + period}))`);
}

async function postRows(tx: DbOrTx, actor: Actor, batch: { id: number; period: Period }, rows: ImportRow[]) {
  const lines = rows.flatMap((r) =>
    allocateDeduction(r.amountKobo!).map((a) => ({ memberId: r.memberId!, amountKobo: a.amountKobo, importRowId: r.id })),
  );
  await insertImportContributions(tx, actor, lines, batch);
  if (rows.length) {
    await tx
      .update(importRows)
      .set({ postedAt: new Date() })
      .where(inArray(importRows.id, rows.map((r) => r.id)));
  }
  return { count: rows.length, totalKobo: rows.reduce((s, r) => s + r.amountKobo!, 0) };
}

/**
 * Post all ok/warning rows. `expected` is what the officer saw and confirmed;
 * if anything changed since (another officer edited a row), commit is refused.
 */
export async function commitBatch(actor: Actor, batchId: number, expected: { count: number; totalKobo: number }) {
  try {
    return await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).for("update");
      if (!locked) throw new DomainError("NOT_FOUND", "Import not found.");
      if (locked.status !== "in_review") throw new DomainError("BATCH_CLOSED", `This import is already ${locked.status}.`);
      if (locked.structureErrors.length) {
        throw new DomainError("STRUCTURE_ERROR", "This file has problems that must be fixed before it can be committed.");
      }
      await lockPeriod(tx, locked.period);
      await validateBatch(tx, batchId);

      const rows = await tx.select().from(importRows).where(eq(importRows.batchId, batchId)).orderBy(asc(importRows.rowNumber));
      const toPost = postableRows(rows);
      const total = toPost.reduce((s, r) => s + r.amountKobo!, 0);
      if (toPost.length !== expected.count || total !== expected.totalKobo) {
        throw new DomainError(
          "STALE",
          `The numbers changed since you reviewed them (now ${toPost.length} rows, ₦${(total / 100).toLocaleString("en-NG")}). Please check and confirm again.`,
        );
      }
      if (!toPost.length) throw new DomainError("NOTHING_TO_POST", "There are no valid rows to post.");

      const posted = await postRows(tx, actor, locked, toPost);
      await tx
        .update(importBatches)
        .set({
          status: "committed",
          committedBy: actor.userId,
          committedAt: new Date(),
          postedCount: posted.count,
          postedTotalKobo: posted.totalKobo,
        })
        .where(eq(importBatches.id, batchId));

      const held = rows.filter((r) => !toPost.includes(r));
      await writeAudit(tx, actor, {
        action: "import.commit",
        entityType: "import_batch",
        entityId: batchId,
        after: {
          period: locked.period,
          postedCount: posted.count,
          postedTotalKobo: posted.totalKobo,
          heldBackCount: held.length,
          heldBackTotalKobo: held.reduce((s, r) => s + (r.amountKobo ?? 0), 0),
        },
      });
      return posted;
    });
  } catch (err) {
    if (isUniqueViolation(err, "import_batches_hash_committed_uq")) {
      throw new DomainError("FILE_ALREADY_COMMITTED", "This exact file has already been committed in another batch.");
    }
    if (isUniqueViolation(err)) {
      throw new DomainError("ALREADY_POSTED", "Some members were posted for this month by another import at the same time. Review again.");
    }
    throw err;
  }
}

/** After commit: post a row that was held back and has since been fixed. */
export async function postHeldBackRow(actor: Actor, rowId: number) {
  try {
    return await db.transaction(async (tx) => {
      const { row, batch } = await lockRowAndBatch(tx, rowId);
      if (batch.status !== "committed") throw new DomainError("INVALID", "Commit the import first; this row will post with it.");
      if (row.resolution === "skipped") throw new DomainError("INVALID", "This row is marked as skipped.");
      await lockPeriod(tx, batch.period);
      await validateBatch(tx, batch.id);
      const [fresh] = await tx.select().from(importRows).where(eq(importRows.id, rowId));
      if (!postableRows([fresh]).length) {
        throw new DomainError("ROW_INVALID", "This row still has a problem; correct it first.");
      }
      const posted = await postRows(tx, actor, batch, [fresh]);
      await tx
        .update(importBatches)
        .set({
          postedCount: sql`${importBatches.postedCount} + ${posted.count}`,
          postedTotalKobo: sql`${importBatches.postedTotalKobo} + ${posted.totalKobo}`,
        })
        .where(eq(importBatches.id, batch.id));
      await writeAudit(tx, actor, {
        action: "import.post_late_row",
        entityType: "import_row",
        entityId: rowId,
        after: { batchId: batch.id, memberId: fresh.memberId, amountKobo: fresh.amountKobo },
      });
      return posted;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("ALREADY_POSTED", "This member already has a bank deduction for this month.");
    throw err;
  }
}

export async function cancelBatch(actor: Actor, batchId: number, reason: string) {
  if (!reason.trim()) throw new DomainError("VALIDATION", "Give a reason for cancelling.", "reason");
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).for("update");
    if (!b) throw new DomainError("NOT_FOUND", "Import not found.");
    if (b.status !== "in_review") throw new DomainError("BATCH_CLOSED", `Only imports in review can be cancelled (this one is ${b.status}).`);
    await tx.update(importBatches).set({ status: "cancelled" }).where(eq(importBatches.id, batchId));
    await writeAudit(tx, actor, { action: "import.cancel", entityType: "import_batch", entityId: batchId, after: { reason } });
  });
}

/* ---------------------------- queries ---------------------------- */

export async function listBatches() {
  return db
    .select({
      batch: importBatches,
      uploadedByName: users.displayName,
      rows: count(importRows.id),
      errors: sql<number>`count(*) filter (where ${importRows.status} = 'error' and ${importRows.resolution} <> 'skipped' and ${importRows.postedAt} is null)::int`,
    })
    .from(importBatches)
    .leftJoin(users, eq(users.id, importBatches.uploadedBy))
    .leftJoin(importRows, eq(importRows.batchId, importBatches.id))
    .groupBy(importBatches.id, users.displayName)
    .orderBy(desc(importBatches.id))
    .limit(100);
}

export type BatchSummary = Awaited<ReturnType<typeof getBatchSummary>>;

export async function getBatchSummary(batchId: number) {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId));
  if (!batch) return null;
  const rows = await db.select().from(importRows).where(eq(importRows.batchId, batchId));
  const sumOf = (list: ImportRow[]) => list.reduce((s, r) => s + (r.amountKobo ?? 0), 0);
  const posted = rows.filter((r) => r.postedAt);
  const skipped = rows.filter((r) => !r.postedAt && r.resolution === "skipped");
  const open = rows.filter((r) => !r.postedAt && r.resolution !== "skipped");
  const ok = open.filter((r) => r.status === "ok");
  const warning = open.filter((r) => r.status === "warning");
  const errors = open.filter((r) => r.status === "error");
  const toPost = postableRows(rows);
  const byCode = new Map<string, { count: number; totalKobo: number }>();
  for (const r of errors) {
    const c = byCode.get(r.errorCode!) ?? { count: 0, totalKobo: 0 };
    c.count++;
    c.totalKobo += r.amountKobo ?? 0;
    byCode.set(r.errorCode!, c);
  }
  const [uploader] = batch.uploadedBy ? await db.select({ name: users.displayName }).from(users).where(eq(users.id, batch.uploadedBy)) : [];
  const [committer] = batch.committedBy ? await db.select({ name: users.displayName }).from(users).where(eq(users.id, batch.committedBy)) : [];
  const [otherCommitted] = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(and(eq(importBatches.period, batch.period), eq(importBatches.status, "committed"), ne(importBatches.id, batch.id)))
    .limit(1);
  return {
    batch,
    uploadedByName: uploader?.name ?? null,
    committedByName: committer?.name ?? null,
    otherCommittedBatchId: otherCommitted?.id ?? null,
    counts: {
      total: rows.length,
      ok: ok.length,
      warning: warning.length,
      error: errors.length,
      skipped: skipped.length,
      posted: posted.length,
    },
    totals: {
      file: sumOf(rows),
      ok: sumOf(ok),
      warning: sumOf(warning),
      error: sumOf(errors),
      skipped: sumOf(skipped),
      posted: sumOf(posted),
    },
    toPost: { count: toPost.length, totalKobo: sumOf(toPost) },
    errorsByCode: [...byCode.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.count - a.count),
  };
}

export type RowFilter = "exceptions" | "all" | "ok" | "warning" | "skipped" | "posted";

export async function listBatchRows(batchId: number, filter: RowFilter) {
  const [batch] = await db.select({ status: importBatches.status }).from(importBatches).where(eq(importBatches.id, batchId));
  // Once committed, anything not posted or skipped is still outstanding — including rows fixed since.
  const committed = batch?.status === "committed";
  const rows = await db
    .select({ row: importRows, memberNo: members.memberNo, memberName: members.fullName })
    .from(importRows)
    .leftJoin(members, eq(members.id, importRows.memberId))
    .where(eq(importRows.batchId, batchId))
    .orderBy(asc(importRows.rowNumber));
  const keep = (r: ImportRow) => {
    switch (filter) {
      case "exceptions":
        return !r.postedAt && r.resolution !== "skipped" && (committed || r.status !== "ok");
      case "ok":
        return !r.postedAt && r.resolution !== "skipped" && r.status === "ok";
      case "warning":
        return !r.postedAt && r.resolution !== "skipped" && r.status === "warning";
      case "skipped":
        return !r.postedAt && r.resolution === "skipped";
      case "posted":
        return !!r.postedAt;
      default:
        return true;
    }
  };
  const suggestedIds = [...new Set(rows.map((r) => r.row.suggestedMemberId).filter((x): x is number => !!x))];
  const suggested = suggestedIds.length
    ? await db.select({ id: members.id, memberNo: members.memberNo, fullName: members.fullName, employeeNo: members.employeeNo }).from(members).where(inArray(members.id, suggestedIds))
    : [];
  const sMap = new Map(suggested.map((s) => [s.id, s]));
  return rows.filter((r) => keep(r.row)).map((r) => ({ ...r, suggested: r.row.suggestedMemberId ? sMap.get(r.row.suggestedMemberId) ?? null : null }));
}

export async function getBatchFile(batchId: number) {
  const [r] = await db
    .select({ name: storedFiles.fileName, type: storedFiles.contentType, content: storedFiles.content })
    .from(importBatches)
    .innerJoin(storedFiles, eq(storedFiles.id, importBatches.fileId))
    .where(eq(importBatches.id, batchId));
  return r ?? null;
}
