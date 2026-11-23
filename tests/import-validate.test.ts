import { describe, expect, it } from "vitest";
import { median, validateRows, type MemberLite, type RowToValidate, type ValidationContext } from "@/server/imports/validate";

const m = (id: number, emp: string, status: MemberLite["status"] = "active", ver: string | null = null): MemberLite => ({
  id,
  memberNo: `CLW${String(id).padStart(5, "0")}`,
  fullName: `Member ${id}`,
  status,
  employeeNo: emp,
  verificationNo: ver,
});

const members = [m(1, "EMP0000001"), m(2, "EMP0000002", "exited"), m(3, "EMP0000003", "suspended"), m(4, "EMP0000004", "active", "8612000004"), m(5, "EMP0000005")];

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  const byEmployeeNo = new Map<string, MemberLite[]>();
  for (const x of members) byEmployeeNo.set(x.employeeNo!, [...(byEmployeeNo.get(x.employeeNo!) ?? []), x]);
  return {
    byEmployeeNo,
    byVerificationNo: new Map(members.filter((x) => x.verificationNo).map((x) => [x.verificationNo!, x])),
    alreadyPosted: new Set(),
    baselineKobo: new Map(),
    postedThisYearKobo: null,
    anomalyThreshold: 0.5,
    suspendedPolicy: "block",
    ...over,
  };
}

let key = 0;
const row = (employmentNo: string | null, amount: number | string | null, over: Partial<RowToValidate> = {}): RowToValidate => ({
  key: ++key,
  employmentNo,
  verificationNo: null,
  amountRaw: amount === null ? null : String(amount),
  amountKobo: typeof amount === "number" ? amount * 100 : null,
  ytdKobo: null,
  skipped: false,
  ...over,
});

const codeOf = (rows: RowToValidate[], c = ctx()) => {
  const res = validateRows(rows, c);
  return rows.map((r) => res.get(r.key)!.errorCode ?? res.get(r.key)!.status);
};

describe("import validation", () => {
  it("accepts a clean row and links the member", () => {
    const r = row("emp0000001", 5000);
    const res = validateRows([r], ctx()).get(r.key)!;
    expect(res).toMatchObject({ status: "ok", memberId: 1, errorCode: null });
  });

  it.each([
    [row(null, 5000), "EMPLOYEE_NO_MISSING"],
    [row("EMP0000001", null), "AMOUNT_MISSING"],
    [row("EMP0000001", "5,000 naira"), "AMOUNT_INVALID"],
    [row("EMP0000001", 0), "AMOUNT_NEGATIVE_OR_ZERO"],
    [row("EMP9999999", 5000), "UNKNOWN_MEMBER"],
    [row("EMP0000002", 5000), "MEMBER_EXITED"],
    [row("EMP0000003", 5000), "MEMBER_SUSPENDED"],
  ])("flags %#: %s", (r, code) => {
    expect(codeOf([r])).toEqual([code]);
  });

  it("allows suspended members when the policy says so", () => {
    expect(codeOf([row("EMP0000003", 5000)], ctx({ suspendedPolicy: "allow" }))).toEqual(["ok"]);
  });

  it("flags every copy of a duplicated employment number, unless the extra copy is skipped", () => {
    const a = row("EMP0000001", 5000);
    const b = row("EMP0000001 ", 5000);
    expect(codeOf([a, b])).toEqual(["DUPLICATE_IN_FILE", "DUPLICATE_IN_FILE"]);
    b.skipped = true;
    expect(codeOf([a, b])[0]).toBe("ok");
  });

  it("blocks a member already posted for the month", () => {
    expect(codeOf([row("EMP0000001", 5000)], ctx({ alreadyPosted: new Set([1]) }))).toEqual(["ALREADY_POSTED"]);
  });

  it("suggests a member by verification number when the employment number is unknown", () => {
    const r = row("EMP7777777", 5000, { verificationNo: "8612000004" });
    const res = validateRows([r], ctx()).get(r.key)!;
    expect(res.errorCode).toBe("UNKNOWN_MEMBER");
    expect(res.suggestedMemberId).toBe(4);
    expect(res.message).toContain("Member 4");
  });

  it("warns (without blocking) on unusual amounts", () => {
    const c = ctx({ baselineKobo: new Map([[1, 500000], [5, 500000]]) });
    const res = validateRows([row("EMP0000001", 20000), row("EMP0000005", 6000)], c);
    expect([...res.values()].map((r) => r.status)).toEqual(["warning", "ok"]);
  });

  it("checks the bank's year-to-date figure when enabled", () => {
    const c = ctx({ postedThisYearKobo: new Map([[1, 2000000]]) });
    const good = row("EMP0000001", 5000, { ytdKobo: 2500000 });
    const bad = row("EMP0000001", 5000, { ytdKobo: 6000000, key: 999 });
    expect(validateRows([good], c).get(good.key)!.status).toBe("ok");
    expect(validateRows([bad], c).get(999)!.warnings).toEqual(["YTD_MISMATCH"]);
  });

  it("computes medians", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});
