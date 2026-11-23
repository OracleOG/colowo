/**
 * Row validation for deduction imports — a pure function of the rows and a
 * snapshot of the member register/ledger, so every rule is unit-testable.
 */
import type { Member } from "@/db/schema";
import type { ImportErrorCode, ImportWarningCode } from "@/lib/import-codes";
import { parseAmountToKobo } from "@/lib/money";
import { normalizeEmployeeNo } from "@/lib/normalize";

export type MemberLite = Pick<Member, "id" | "memberNo" | "fullName" | "status" | "employeeNo" | "verificationNo">;

export type RowToValidate = {
  key: number; // row id or row number
  employmentNo: string | null;
  verificationNo: string | null;
  amountRaw: string | null;
  /** Effective amount (parsed or corrected); null if it couldn't be parsed. */
  amountKobo: number | null;
  ytdKobo: number | null;
  skipped: boolean;
};

export type ValidationContext = {
  /** All members (any status) by normalised employment number. */
  byEmployeeNo: Map<string, MemberLite[]>;
  byVerificationNo: Map<string, MemberLite>;
  /** Members who already have a bank contribution posted for this period. */
  alreadyPosted: Set<number>;
  /** Typical monthly deduction per member (median of recent ones). */
  baselineKobo: Map<number, number>;
  /** Contributions posted earlier in the same calendar year, for the YTD check. Null = check off. */
  postedThisYearKobo: Map<number, number> | null;
  anomalyThreshold: number; // e.g. 0.5 = flag if ±50% from usual
  suspendedPolicy: "block" | "allow";
};

export type RowResult = {
  status: "ok" | "warning" | "error";
  errorCode: ImportErrorCode | null;
  warnings: ImportWarningCode[];
  message: string | null;
  memberId: number | null;
  suggestedMemberId: number | null;
};

/** Prefer a live member; otherwise the most recently created exited one. */
function pickMember(candidates: MemberLite[] | undefined): MemberLite | null {
  if (!candidates?.length) return null;
  return (
    candidates.find((m) => m.status === "active") ??
    candidates.find((m) => m.status === "suspended") ??
    [...candidates].sort((a, b) => b.id - a.id)[0]
  );
}

export function validateRows(rows: RowToValidate[], ctx: ValidationContext): Map<number, RowResult> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.skipped || !r.employmentNo) continue;
    const k = normalizeEmployeeNo(r.employmentNo)!;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const out = new Map<number, RowResult>();
  for (const r of rows) {
    const res: RowResult = { status: "ok", errorCode: null, warnings: [], message: null, memberId: null, suggestedMemberId: null };
    const fail = (code: ImportErrorCode, message: string | null = null) => {
      if (!res.errorCode) {
        res.status = "error";
        res.errorCode = code;
        res.message = message;
      }
    };

    const emp = normalizeEmployeeNo(r.employmentNo);
    const member = emp ? pickMember(ctx.byEmployeeNo.get(emp)) : null;
    if (member) res.memberId = member.id;

    if (!emp) fail("EMPLOYEE_NO_MISSING");

    if (r.amountKobo === null) {
      const p = parseAmountToKobo(r.amountRaw);
      fail(!p.ok && p.reason === "missing" ? "AMOUNT_MISSING" : "AMOUNT_INVALID");
    } else if (r.amountKobo <= 0) {
      fail("AMOUNT_NEGATIVE_OR_ZERO");
    }

    if (emp && !r.skipped && (counts.get(emp) ?? 0) > 1) {
      fail("DUPLICATE_IN_FILE", `Appears ${counts.get(emp)} times`);
    }

    if (emp && !member) {
      const v = normalizeEmployeeNo(r.verificationNo);
      const suggestion = v ? ctx.byVerificationNo.get(v) : undefined;
      if (suggestion) res.suggestedMemberId = suggestion.id;
      fail(
        "UNKNOWN_MEMBER",
        suggestion
          ? `Verification no. matches ${suggestion.fullName} (${suggestion.memberNo}), whose employment no. is ${suggestion.employeeNo ?? "not recorded"}`
          : null,
      );
    }

    if (member) {
      if (member.status === "exited") fail("MEMBER_EXITED", `${member.fullName} (${member.memberNo})`);
      if (member.status === "suspended" && ctx.suspendedPolicy === "block") {
        fail("MEMBER_SUSPENDED", `${member.fullName} (${member.memberNo})`);
      }
      if (ctx.alreadyPosted.has(member.id)) fail("ALREADY_POSTED");

      if (r.amountKobo !== null && r.amountKobo > 0) {
        const base = ctx.baselineKobo.get(member.id);
        if (base && Math.abs(r.amountKobo - base) / base > ctx.anomalyThreshold) {
          res.warnings.push("AMOUNT_ANOMALY");
        }
        if (ctx.postedThisYearKobo && r.ytdKobo !== null) {
          const expected = (ctx.postedThisYearKobo.get(member.id) ?? 0) + r.amountKobo;
          if (expected !== r.ytdKobo) res.warnings.push("YTD_MISMATCH");
        }
      }
    }

    if (res.status === "ok" && res.warnings.length) res.status = "warning";
    out.set(r.key, res);
  }
  return out;
}

/** Median of the last `n` amounts (oldest → newest order not required). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
