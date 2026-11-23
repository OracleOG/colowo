/**
 * Membership service. All member writes go through here so that the
 * unique-ID rules, duplicate checks and audit logging are always applied.
 */
import { and, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { members, type Member } from "@/db/schema";
import { todayLagos } from "@/lib/format";
import { cleanName, nameKey, normalizeEmployeeNo, normalizePhone } from "@/lib/normalize";
import { diff, writeAudit, type Actor } from "./audit";
import { DomainError, isUniqueViolation } from "./errors";

/* ---------------------------- validation ---------------------------- */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

export const memberInputSchema = z.object({
  fullName: z.string().trim().min(3, "Enter the member's full name").max(200).transform(cleanName),
  employeeNo: optionalText(50).transform(normalizeEmployeeNo),
  verificationNo: optionalText(50).transform(normalizeEmployeeNo),
  fileNo: optionalText(50),
  phone: optionalText(30).transform((v, ctx) => {
    const p = normalizePhone(v);
    if (p === undefined) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number, e.g. 0803 123 4567" });
      return z.NEVER;
    }
    return p;
  }),
  email: optionalText(200).pipe(z.email("Enter a valid email address").nullable()),
  dateJoined: ymd.refine((d) => d <= todayLagos(), "Date joined cannot be in the future"),
  legacyRef: optionalText(100),
  notes: optionalText(2000),
});

export type MemberInput = z.input<typeof memberInputSchema>;
type CleanMemberInput = z.output<typeof memberInputSchema>;

export function parseMemberInput(input: MemberInput): CleanMemberInput {
  const r = memberInputSchema.safeParse(input);
  if (!r.success) {
    const fieldErrors = z.flattenError(r.error).fieldErrors;
    throw new DomainError("VALIDATION", "Please correct the highlighted fields.", undefined, fieldErrors);
  }
  return r.data;
}

/* ---------------------------- member numbers ---------------------------- */

export function formatMemberNo(n: number): string {
  const prefix = process.env.MEMBER_NO_PREFIX ?? "CLW";
  return `${prefix}${String(n).padStart(5, "0")}`;
}

async function nextMemberNo(tx: DbOrTx): Promise<string> {
  const r = await tx.execute<{ n: string }>(sql`select nextval('member_no_seq') as n`);
  return formatMemberNo(Number(r.rows[0].n));
}

/* ---------------------------- rule checks ---------------------------- */

const LIVE: Member["status"][] = ["active", "suspended"];

async function assertEmployeeNoFree(tx: DbOrTx, employeeNo: string | null, exceptId?: number) {
  if (!employeeNo) return;
  const conds: SQL[] = [eq(members.employeeNo, employeeNo), inArray(members.status, LIVE)];
  if (exceptId) conds.push(ne(members.id, exceptId));
  const [clash] = await tx
    .select({ memberNo: members.memberNo, fullName: members.fullName })
    .from(members)
    .where(and(...conds))
    .limit(1);
  if (clash) {
    throw new DomainError(
      "EMPLOYEE_NO_TAKEN",
      `Employee number ${employeeNo} already belongs to ${clash.fullName} (${clash.memberNo}).`,
      "employeeNo",
    );
  }
}

export type DuplicateCandidate = Pick<Member, "id" | "memberNo" | "fullName" | "phone" | "status">;

/** Same name + same phone on another non-exited member → probable duplicate. */
async function findLikelyDuplicates(
  tx: DbOrTx,
  input: { fullName: string; phone: string | null },
  exceptId?: number,
): Promise<DuplicateCandidate[]> {
  if (!input.phone) return [];
  const conds: SQL[] = [
    sql`lower(regexp_replace(trim(${members.fullName}), '\\s+', ' ', 'g')) = ${nameKey(input.fullName)}`,
    eq(members.phone, input.phone),
    ne(members.status, "exited"),
  ];
  if (exceptId) conds.push(ne(members.id, exceptId));
  return tx
    .select({
      id: members.id,
      memberNo: members.memberNo,
      fullName: members.fullName,
      phone: members.phone,
      status: members.status,
    })
    .from(members)
    .where(and(...conds));
}

function rethrowConstraint(err: unknown): never {
  if (isUniqueViolation(err, "members_employee_no_live_uq")) {
    throw new DomainError("EMPLOYEE_NO_TAKEN", "That employee number is already in use.", "employeeNo");
  }
  throw err;
}

/* ---------------------------- commands ---------------------------- */

export async function createMember(
  actor: Actor,
  input: MemberInput,
  opts: { allowDuplicate?: boolean; tx?: DbOrTx } = {},
): Promise<Member> {
  const data = parseMemberInput(input);
  const run = async (tx: DbOrTx) => {
    await assertEmployeeNoFree(tx, data.employeeNo);
    if (!opts.allowDuplicate) {
      const dupes = await findLikelyDuplicates(tx, data);
      if (dupes.length) {
        throw new DomainError(
          "POSSIBLE_DUPLICATE",
          "A member with the same name and phone number already exists.",
          undefined,
          dupes,
        );
      }
    }
    const memberNo = await nextMemberNo(tx);
    const [row] = await tx.insert(members).values({ ...data, memberNo }).returning();
    await writeAudit(tx, actor, {
      action: "member.create",
      entityType: "member",
      entityId: row.id,
      after: row,
    });
    return row;
  };
  try {
    return opts.tx ? await run(opts.tx) : await db.transaction(run);
  } catch (err) {
    rethrowConstraint(err);
  }
}

export async function updateMember(
  actor: Actor,
  id: number,
  input: MemberInput,
  opts: { allowDuplicate?: boolean } = {},
): Promise<Member> {
  const data = parseMemberInput(input);
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(members).where(eq(members.id, id)).for("update");
      if (!current) throw new DomainError("NOT_FOUND", "Member not found.");

      if (current.status !== "exited") await assertEmployeeNoFree(tx, data.employeeNo, id);
      if (!opts.allowDuplicate && current.status !== "exited") {
        const dupes = await findLikelyDuplicates(tx, data, id);
        if (dupes.length) {
          throw new DomainError(
            "POSSIBLE_DUPLICATE",
            "Another member has the same name and phone number.",
            undefined,
            dupes,
          );
        }
      }
      if (current.dateExited && data.dateJoined > current.dateExited) {
        throw new DomainError("VALIDATION", "Date joined cannot be after the exit date.", "dateJoined");
      }

      const changes = diff(current, data);
      if (!changes) return current;

      const [row] = await tx.update(members).set(data).where(eq(members.id, id)).returning();
      await writeAudit(tx, actor, {
        action: "member.update",
        entityType: "member",
        entityId: id,
        ...changes,
      });
      return row;
    });
  } catch (err) {
    rethrowConstraint(err);
  }
}

/**
 * Status transitions:
 *   active ⇄ suspended, active|suspended → exited.
 * Exited is final for now — [CONFIRM] whether exited members may rejoin
 * (if so, likely as a new membership with a new member number).
 */
export async function changeMemberStatus(
  actor: Actor,
  id: number,
  input: { status: Member["status"]; reason: string; dateExited?: string },
): Promise<Member> {
  const reason = input.reason?.trim();
  if (!reason) throw new DomainError("VALIDATION", "Give a reason for this change.", "reason");

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(members).where(eq(members.id, id)).for("update");
      if (!current) throw new DomainError("NOT_FOUND", "Member not found.");
      if (current.status === input.status) return current;
      if (current.status === "exited") {
        throw new DomainError("INVALID_TRANSITION", "An exited member cannot be reactivated.");
      }

      let dateExited: string | null = null;
      if (input.status === "exited") {
        dateExited = input.dateExited ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateExited)) {
          throw new DomainError("VALIDATION", "Enter the exit date.", "dateExited");
        }
        if (dateExited < current.dateJoined) {
          throw new DomainError("VALIDATION", "Exit date cannot be before the date joined.", "dateExited");
        }
        if (dateExited > todayLagos()) {
          throw new DomainError("VALIDATION", "Exit date cannot be in the future.", "dateExited");
        }
      } else if (input.status === "active") {
        // Re-activating a suspended member: their employee number must still be free.
        await assertEmployeeNoFree(tx, current.employeeNo, id);
      }

      const [row] = await tx
        .update(members)
        .set({ status: input.status, dateExited })
        .where(eq(members.id, id))
        .returning();
      await writeAudit(tx, actor, {
        action: input.status === "exited" ? "member.exit" : "member.status_change",
        entityType: "member",
        entityId: id,
        before: { status: current.status, dateExited: current.dateExited },
        after: { status: row.status, dateExited: row.dateExited, reason },
      });
      return row;
    });
  } catch (err) {
    rethrowConstraint(err);
  }
}

/* ---------------------------- queries ---------------------------- */

export const PAGE_SIZE = 50;

export async function searchMembers(params: {
  q?: string;
  status?: Member["status"] | "all";
  page?: number;
}) {
  const conds: SQL[] = [];
  const q = params.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(
        ilike(members.fullName, like),
        ilike(members.memberNo, like),
        ilike(members.employeeNo, like),
        ilike(members.phone, like),
      )!,
    );
  }
  if (params.status && params.status !== "all") conds.push(eq(members.status, params.status));
  const where = conds.length ? and(...conds) : undefined;
  const page = Math.max(1, params.page ?? 1);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(members)
      .where(where)
      .orderBy(desc(members.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(members).where(where),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getMember(id: number): Promise<Member | null> {
  const [row] = await db.select().from(members).where(eq(members.id, id));
  return row ?? null;
}

export async function memberStatusCounts() {
  const rows = await db
    .select({ status: members.status, n: count() })
    .from(members)
    .groupBy(members.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<Member["status"], number>>;
}
