/**
 * Colowo database schema — foundation (Milestone 1).
 *
 * Covers identity & access, audit log and membership. Ledger tables (imports,
 * savings, loans, interest) are added in later milestones, once the
 * cooperative's real Excel workbooks have been reviewed.
 *
 * Conventions
 * - Money is always integer kobo (bigint), never floating point.
 * - Timestamps are timestamptz (stored UTC, displayed Africa/Lagos).
 * - Calendar dates (date joined/exited) are plain `date` strings (YYYY-MM-DD).
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  bigint,
  boolean,
  check,
  customType,
  date,
  numeric,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ------------------------------------------------------------------ */
/* Membership                                                          */
/* ------------------------------------------------------------------ */

export const memberStatus = pgEnum("member_status", ["active", "suspended", "exited"]);

/** Source of system-generated member numbers. Never reused. */
export const memberNoSeq = pgSequence("member_no_seq", { startWith: 1 });

export const members = pgTable(
  "members",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Canonical, system-generated, immutable (enforced by trigger). */
    memberNo: text("member_no").notNull().unique(),
    /** Payroll EMPLOYMENT NUMBER on the bank file (e.g. EMP0013145) — the import match key. */
    employeeNo: text("employee_no"),
    /** Payroll VERIFICATION NO on the bank file — used to suggest matches. */
    verificationNo: text("verification_no"),
    /** Personnel file number used in the old general deduction record (e.g. SP/956). */
    fileNo: text("file_no"),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    status: memberStatus("status").notNull().default("active"),
    dateJoined: date("date_joined", { mode: "string" }).notNull(),
    dateExited: date("date_exited", { mode: "string" }),
    /** Reference in the old Excel workbooks (e.g. sheet name), for migration. */
    legacyRef: text("legacy_ref"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    // employee_no is unique among members who can still receive deductions.
    uniqueIndex("members_employee_no_live_uq")
      .on(t.employeeNo)
      .where(sql`status in ('active', 'suspended') and employee_no is not null`),
    index("members_full_name_idx").on(t.fullName),
    index("members_status_idx").on(t.status),
    check(
      "members_exit_date_chk",
      sql`(status = 'exited') = (date_exited is not null)`,
    ),
    check(
      "members_exit_after_join_chk",
      sql`date_exited is null or date_exited >= date_joined`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Identity & access                                                   */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Lower-cased login: email for staff, member number for members. */
    login: text("login").notNull().unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Set when this login belongs to a cooperative member. */
    memberId: bigint("member_id", { mode: "number" })
      .unique()
      .references(() => members.id),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
);

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
});

export const permissions = pgTable("permissions", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => permissions.code, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

/* ------------------------------------------------------------------ */
/* Audit log (append-only, enforced by trigger)                         */
/* ------------------------------------------------------------------ */

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Null for system actions (seed, migration scripts). */
    userId: bigint("user_id", { mode: "number" }).references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_user_idx").on(t.userId),
    index("audit_at_idx").on(t.at),
  ],
);

/* ------------------------------------------------------------------ */
/* Stored files (uploaded bank files, kept privately in the database)   */
/* ------------------------------------------------------------------ */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const storedFiles = pgTable("stored_files", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sha256: text("sha256").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  content: bytea("content").notNull(),
  uploadedBy: bigint("uploaded_by", { mode: "number" }).references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Deduction imports                                                   */
/* ------------------------------------------------------------------ */

export const importBatchStatus = pgEnum("import_batch_status", ["in_review", "committed", "cancelled"]);
export const importRowStatus = pgEnum("import_row_status", ["ok", "warning", "error"]);
export const importRowResolution = pgEnum("import_row_resolution", ["none", "corrected", "skipped"]);

/** Accounting period "YYYY-MM". */
const period = (name: string) => text(name);
const periodCheck = (name: string, col: string) => check(name, sql.raw(`${col} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`));

export const importBatches = pgTable(
  "import_batches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    period: period("period").notNull(),
    format: text("format").notNull(),
    fileId: bigint("file_id", { mode: "number" }).notNull().references(() => storedFiles.id),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    status: importBatchStatus("status").notNull().default("in_review"),
    /** Period text found inside the file, e.g. "May 2026". */
    filePeriodLabel: text("file_period_label"),
    /** Problems with the file as a whole; commit is blocked while any exist. */
    structureErrors: jsonb("structure_errors").$type<string[]>().notNull().default([]),
    /** Informative notes about the file (not blocking). */
    notices: jsonb("notices").$type<string[]>().notNull().default([]),
    controlCount: integer("control_count"),
    controlTotalKobo: bigint("control_total_kobo", { mode: "number" }),
    parsedCount: integer("parsed_count").notNull(),
    parsedTotalKobo: bigint("parsed_total_kobo", { mode: "number" }).notNull(),
    postedCount: integer("posted_count").notNull().default(0),
    postedTotalKobo: bigint("posted_total_kobo", { mode: "number" }).notNull().default(0),
    uploadedBy: bigint("uploaded_by", { mode: "number" }).references(() => users.id),
    committedBy: bigint("committed_by", { mode: "number" }).references(() => users.id),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    periodCheck("import_batches_period_chk", "period"),
    // The same file can never be committed twice (but a cancelled one can be re-uploaded).
    uniqueIndex("import_batches_hash_committed_uq").on(t.fileHash).where(sql`status = 'committed'`),
    index("import_batches_period_idx").on(t.period),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    batchId: bigint("batch_id", { mode: "number" })
      .notNull()
      .references(() => importBatches.id),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").notNull(),
    section: text("section"),
    employmentNoRaw: text("employment_no_raw"),
    verificationNoRaw: text("verification_no_raw"),
    nameRaw: text("name_raw"),
    amountRaw: text("amount_raw"),
    ytdKobo: bigint("ytd_kobo", { mode: "number" }),
    /** Effective values after any correction by an officer. */
    employmentNo: text("employment_no"),
    amountKobo: bigint("amount_kobo", { mode: "number" }),
    memberId: bigint("member_id", { mode: "number" }).references(() => members.id),
    suggestedMemberId: bigint("suggested_member_id", { mode: "number" }).references(() => members.id),
    status: importRowStatus("status").notNull(),
    errorCode: text("error_code"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    message: text("message"),
    resolution: importRowResolution("resolution").notNull().default("none"),
    resolvedBy: bigint("resolved_by", { mode: "number" }).references(() => users.id),
    note: text("note"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("import_rows_batch_idx").on(t.batchId),
    uniqueIndex("import_rows_batch_row_uq").on(t.batchId, t.rowNumber),
  ],
);

/* ------------------------------------------------------------------ */
/* Savings ledger (append-only, enforced by trigger)                    */
/* ------------------------------------------------------------------ */

export const savingsTxnType = pgEnum("savings_txn_type", [
  "contribution",
  "withdrawal",
  "adjustment",
  "reversal",
  "migrated_opening",
]);
export const txnSource = pgEnum("txn_source", ["import", "manual", "migration", "seed"]);

export const savingsTransactions = pgTable(
  "savings_transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    memberId: bigint("member_id", { mode: "number" })
      .notNull()
      .references(() => members.id),
    /** Month the money belongs to (drives balances and earnings). */
    period: period("period").notNull(),
    txnDate: date("txn_date", { mode: "string" }).notNull(),
    type: savingsTxnType("type").notNull(),
    /** Signed: credits positive, debits negative. */
    amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
    source: txnSource("source").notNull(),
    batchId: bigint("batch_id", { mode: "number" }).references(() => importBatches.id),
    importRowId: bigint("import_row_id", { mode: "number" })
      .unique()
      .references(() => importRows.id),
    /** "memberId:period" for contributions from bank files — at most one per member per month. */
    importKey: text("import_key").unique(),
    reversesId: bigint("reverses_id", { mode: "number" })
      .unique()
      .references((): AnyPgColumn => savingsTransactions.id),
    narration: text("narration"),
    createdBy: bigint("created_by", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    periodCheck("savings_period_chk", "period"),
    index("savings_member_period_idx").on(t.memberId, t.period),
    check("savings_amount_nonzero_chk", sql`amount_kobo <> 0`),
    check(
      "savings_sign_chk",
      sql`(type <> 'contribution' or amount_kobo > 0) and (type <> 'withdrawal' or amount_kobo < 0)`,
    ),
    check("savings_reversal_link_chk", sql`(type = 'reversal') = (reverses_id is not null)`),
    check("savings_import_source_chk", sql`(import_key is null) or (source = 'import' and batch_id is not null)`),
  ],
);

/** Monthly earnings rate in force from a period onward (e.g. 2022-01 → 0.005). */
export const earningRates = pgTable(
  "earning_rates",
  {
    effectiveFrom: period("effective_from").primaryKey(),
    monthlyRate: numeric("monthly_rate", { precision: 9, scale: 6 }).notNull(),
    note: text("note"),
    createdBy: bigint("created_by", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [periodCheck("earning_rates_period_chk", "effective_from")],
);

export type Member = typeof members.$inferSelect;
export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;
export type SavingsTxn = typeof savingsTransactions.$inferSelect;
export type User = typeof users.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;

/* ------------------------------------------------------------------ */
/* Loans — schemes, applications, offers (see docs/LOANS.md)            */
/* ------------------------------------------------------------------ */

export const loanType = pgEnum("loan_type", ["regular", "commodity", "special"]);
export const loanSchemeStatus = pgEnum("loan_scheme_status", ["open", "closed"]);
export const loanApplicationStatus = pgEnum("loan_application_status", [
  "submitted",
  "offered",
  "adjustment_requested",
  "accepted",
  "declined",
  "rejected",
  "cancelled",
  "disbursed",
]);
export const loanOfferResponse = pgEnum("loan_offer_response", ["accepted", "declined", "adjustment_requested"]);

/** A loan round the cooperative advertises ("December special loan"). Loans can also be general requests with no scheme. */
export const loanSchemes = pgTable("loan_schemes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  type: loanType("type").notNull(),
  description: text("description"),
  poolKobo: bigint("pool_kobo", { mode: "number" }),
  maxPerMemberKobo: bigint("max_per_member_kobo", { mode: "number" }),
  /** Flat interest for the whole loan, in percent (e.g. "10.000"). [CONFIRM] */
  defaultRatePercent: numeric("default_rate_percent", { precision: 7, scale: 3 }).notNull(),
  defaultTenureMonths: integer("default_tenure_months").notNull(),
  opensOn: date("opens_on", { mode: "string" }).notNull(),
  closesOn: date("closes_on", { mode: "string" }),
  status: loanSchemeStatus("status").notNull().default("open"),
  createdBy: bigint("created_by", { mode: "number" }).references(() => users.id),
  ...timestamps,
});

export const loanApplications = pgTable(
  "loan_applications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    memberId: bigint("member_id", { mode: "number" })
      .notNull()
      .references(() => members.id),
    /** Null for a general loan request. */
    schemeId: bigint("scheme_id", { mode: "number" }).references(() => loanSchemes.id),
    loanType: loanType("loan_type").notNull(),
    requestedKobo: bigint("requested_kobo", { mode: "number" }).notNull(),
    purpose: text("purpose").notNull(),
    preferredTenureMonths: integer("preferred_tenure_months"),
    status: loanApplicationStatus("status").notNull().default("submitted"),
    /** Who typed it in: the member, or a staff user on their behalf. */
    submittedBy: bigint("submitted_by", { mode: "number" }).references(() => users.id),
    onBehalf: boolean("on_behalf").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("loan_applications_member_idx").on(t.memberId),
    index("loan_applications_status_idx").on(t.status),
    check("loan_applications_amount_chk", sql`requested_kobo > 0`),
  ],
);

export const loanOffers = pgTable(
  "loan_offers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    applicationId: bigint("application_id", { mode: "number" })
      .notNull()
      .references(() => loanApplications.id),
    version: integer("version").notNull(),
    amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
    ratePercent: numeric("rate_percent", { precision: 7, scale: 3 }).notNull(),
    interestKobo: bigint("interest_kobo", { mode: "number" }).notNull(),
    totalKobo: bigint("total_kobo", { mode: "number" }).notNull(),
    tenureMonths: integer("tenure_months").notNull(),
    instalmentKobo: bigint("instalment_kobo", { mode: "number" }).notNull(),
    firstRepaymentPeriod: period("first_repayment_period").notNull(),
    conditions: text("conditions"),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    offeredBy: bigint("offered_by", { mode: "number" }).references(() => users.id),
    response: loanOfferResponse("response"),
    responseNote: text("response_note"),
    respondedBy: bigint("responded_by", { mode: "number" }).references(() => users.id),
    respondedOnBehalf: boolean("responded_on_behalf"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("loan_offers_app_version_uq").on(t.applicationId, t.version),
    periodCheck("loan_offers_first_period_chk", "first_repayment_period"),
    check("loan_offers_amount_chk", sql`amount_kobo > 0 and tenure_months > 0 and total_kobo = amount_kobo + interest_kobo`),
  ],
);

/** Timeline of everything that happened to an application (and who did it). */
export const loanEvents = pgTable(
  "loan_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    applicationId: bigint("application_id", { mode: "number" })
      .notNull()
      .references(() => loanApplications.id),
    kind: text("kind").notNull(),
    note: text("note"),
    actorUserId: bigint("actor_user_id", { mode: "number" }).references(() => users.id),
    onBehalf: boolean("on_behalf").notNull().default(false),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("loan_events_app_idx").on(t.applicationId)],
);

export type LoanScheme = typeof loanSchemes.$inferSelect;
export type LoanApplication = typeof loanApplications.$inferSelect;
export type LoanOffer = typeof loanOffers.$inferSelect;
