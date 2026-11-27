/**
 * Named permissions and the default roles built from them.
 * Committees can later be mapped to new roles without schema changes.
 */
export const PERMISSIONS = {
  "self.view": "View own profile, savings and loans",
  "member.view": "View and search the member register",
  "member.manage": "Create, edit, suspend and exit members",
  "import.upload": "Upload and review bank deduction files",
  "import.commit": "Commit a reviewed deduction import to the ledgers",
  "ledger.view": "View savings and loan ledgers",
  "ledger.manual_entry": "Record manual savings/loan transactions",
  "ledger.adjust": "Post adjustments and reversals",
  "loan.manage": "Apply and respond to offers on a member's behalf; record payouts and repayments",
  "loan.approve": "Make loan offers, reject applications, manage loan schemes",
  "interest.run": "Prepare interest runs",
  "interest.post": "Post or reverse interest runs",
  "report.view": "View and export reports",
  "audit.view": "View the audit log",
  "user.manage": "Manage user accounts and roles",
  "config.manage": "Change system configuration (rules, mappings, thresholds)",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLES: Record<
  string,
  { name: string; description: string; permissions: Permission[] }
> = {
  member: {
    name: "Member",
    description: "Cooperative member — read-only access to own records",
    permissions: ["self.view"],
  },
  finance_officer: {
    name: "Data Entry / Finance Officer",
    description: "Day-to-day imports, manual entries and reports",
    permissions: [
      "member.view",
      "import.upload",
      "import.commit",
      "ledger.view",
      "ledger.manual_entry",
      "loan.manage",
      "report.view",
    ],
  },
  loan_officer: {
    name: "Loan officer",
    description: "Handles loan applications, payouts and repayments for members",
    permissions: ["member.view", "ledger.view", "loan.manage", "report.view"],
  },
  loan_approver: {
    name: "Loan approver (loan committee)",
    description: "Makes loan offers, rejects applications and manages loan schemes",
    permissions: ["member.view", "ledger.view", "loan.approve", "report.view"],
  },
  admin: {
    name: "Admin",
    description: "Full access",
    permissions: ALL_PERMISSIONS,
  },
  viewer: {
    name: "Viewer (Board/Exec/Auditor)",
    description: "Read-only access to registers, ledgers and reports",
    permissions: ["member.view", "ledger.view", "report.view", "audit.view"],
  },
};

/** Any permission that grants access to the staff back office. */
export const STAFF_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter(
  (p) => p !== "self.view",
);
