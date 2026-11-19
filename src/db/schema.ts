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
  bigserial,
  bigint,
  boolean,
  check,
  date,
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
    /** Number the bank/employer uses on the deduction file. */
    employeeNo: text("employee_no"),
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

export type Member = typeof members.$inferSelect;
export type User = typeof users.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
