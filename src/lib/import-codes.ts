/** Import exception codes and their plain-English meaning (shared by UI and reports). */
export const IMPORT_ERRORS = {
  EMPLOYEE_NO_MISSING: "No employment number on this row",
  AMOUNT_MISSING: "Amount is blank",
  AMOUNT_INVALID: "Amount isn't a valid number",
  AMOUNT_NEGATIVE_OR_ZERO: "Amount is zero or negative",
  DUPLICATE_IN_FILE: "Employment number appears more than once in this file",
  UNKNOWN_MEMBER: "No member has this employment number",
  MEMBER_EXITED: "Member has exited the cooperative",
  MEMBER_SUSPENDED: "Member is suspended",
  ALREADY_POSTED: "Member already has a bank deduction posted for this month",
} as const;

export const IMPORT_WARNINGS = {
  AMOUNT_ANOMALY: "Amount is very different from this member's usual deduction",
  YTD_MISMATCH: "Bank's year-to-date figure doesn't match Colowo's records",
} as const;

export type ImportErrorCode = keyof typeof IMPORT_ERRORS;
export type ImportWarningCode = keyof typeof IMPORT_WARNINGS;

export function describeCode(code: string | null | undefined): string {
  if (!code) return "";
  return (
    (IMPORT_ERRORS as Record<string, string>)[code] ??
    (IMPORT_WARNINGS as Record<string, string>)[code] ??
    code
  );
}
