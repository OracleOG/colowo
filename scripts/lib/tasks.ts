/**
 * Database tasks shared by `npm run dev`, `db:migrate`, `db:seed` and `demo:bank-file`.
 * Import this only after DATABASE_URL is set: the connection pool reads it on load.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fakerEN_NG as faker } from "@faker-js/faker";
import { count, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../../src/db";
import { members, savingsTransactions, users } from "../../src/db/schema";
import { addMonths, formatPeriod } from "../../src/lib/period";
import { SYSTEM } from "../../src/server/audit";
import { syncRolesAndPermissions } from "../../src/server/auth/roles";
import { createMemberLogin, createUser } from "../../src/server/auth/users";
import { buildKadunaPayrollFile } from "../../src/server/imports/sample-file";
import { changeMemberStatus, createMember } from "../../src/server/members";

export { pool };

/** A demo loan scheme and a few applications in different states, if there are none. */
export async function seedDemoLoans() {
  const { loanApplications } = await import("../../src/db/schema");
  const [{ n }] = await db.select({ n: count() }).from(loanApplications);
  if (n > 0) return;
  const { applyForLoan, createScheme, makeOffer, respondToOffer } = await import("../../src/server/loans/applications");
  const { DEFAULT_ROLES } = await import("../../src/lib/permissions");
  const { todayLagos } = await import("../../src/lib/format");
  const [approverUser] = await db.select().from(users).where(eq(users.login, "approver@colowo.local"));
  const [officerUser] = await db.select().from(users).where(eq(users.login, "loans@colowo.local"));
  const approver = { userId: approverUser.id, memberId: null, permissions: new Set(DEFAULT_ROLES.loan_approver.permissions) };
  const officer = { userId: officerUser.id, memberId: null, permissions: new Set(DEFAULT_ROLES.loan_officer.permissions) };
  const scheme = await createScheme(approver, {
    name: "December special loan",
    type: "special",
    description: "End-of-year loan. Repaid through payroll from February.",
    poolKobo: 20_000_000_00,
    maxPerMemberKobo: 300_000_00,
    defaultRatePercent: "10",
    defaultTenureMonths: 10,
    opensOn: todayLagos(),
  });
  const people = await db.select().from(members).where(eq(members.status, "active")).orderBy(members.id).limit(8);
  const next = addMonths(todayLagos().slice(0, 7), 1);
  // CLW00001 (the demo member login) gets an offer to answer on their phone.
  const a1 = await applyForLoan(officer, { memberId: people[0].id, loanType: "regular", requestedKobo: 200_000_00, purpose: "School fees" });
  await makeOffer(approver, a1.id, { amountKobo: 100_000_00, ratePercent: "10", tenureMonths: 10, firstRepaymentPeriod: next, conditions: "Guarantor form required before payment" });
  await applyForLoan(officer, { memberId: people[1].id, schemeId: scheme.id, requestedKobo: 300_000_00, purpose: "Shop stock" });
  await applyForLoan(officer, { memberId: people[2].id, loanType: "commodity", requestedKobo: 45_000_00, purpose: "Rice and cooking oil" });
  const a4 = await applyForLoan(officer, { memberId: people[3].id, schemeId: scheme.id, requestedKobo: 150_000_00, purpose: "Rent" });
  await makeOffer(approver, a4.id, { amountKobo: 150_000_00, ratePercent: "10", tenureMonths: 10, firstRepaymentPeriod: next });
  await respondToOffer(officer, a4.id, { response: "accepted", note: "Signed at the office" });
  const a5 = await applyForLoan(officer, { memberId: people[4].id, loanType: "regular", requestedKobo: 250_000_00, purpose: "Medical bills" });
  await makeOffer(approver, a5.id, { amountKobo: 150_000_00, ratePercent: "10", tenureMonths: 10, firstRepaymentPeriod: next });
  await respondToOffer(officer, a5.id, { response: "adjustment_requested", note: "Member asks for ₦200,000 over 12 months" });
}

export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.resolve("drizzle") });
}

export async function memberCount(): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(members);
  return n;
}

export const DEMO_STAFF = [
  { login: "admin@colowo.local", displayName: "Demo Admin", roleCodes: ["admin"], what: "everything" },
  { login: "finance@colowo.local", displayName: "Demo Finance Officer", roleCodes: ["finance_officer"], what: "imports, savings" },
  { login: "loans@colowo.local", displayName: "Demo Loan Officer", roleCodes: ["loan_officer"], what: "loans for members" },
  { login: "approver@colowo.local", displayName: "Demo Loan Approver", roleCodes: ["loan_approver"], what: "loan offers, schemes" },
  { login: "board@colowo.local", displayName: "Demo Board Viewer", roleCodes: ["viewer"], what: "read-only" },
];

/** Roles/permissions are kept in step with the code, and demo staff logins exist. Safe on every start. */
export async function ensureRolesAndDemoStaff() {
  await db.transaction((tx) => syncRolesAndPermissions(tx));
  if (process.env.NODE_ENV === "production") return;
  for (const { what: _what, ...s } of DEMO_STAFF) {
    const [exists] = await db.select().from(users).where(eq(users.login, s.login));
    if (!exists) await createUser(SYSTEM, { ...s, password: "Colowo!2026", mustChangePassword: false });
  }
}

/** Demo data: roles, staff logins, ~520 members with savings history. Skips what exists. */
export async function seedDemo(log: (s: string) => void = console.log) {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  await ensureRolesAndDemoStaff();
  if ((await memberCount()) > 0) return;

  faker.seed(2026);
  const TOTAL = 520;
  const used = new Set<string>();
  const unique = (make: () => string) => {
    let v: string;
    do v = make();
    while (used.has(v));
    used.add(v);
    return v;
  };
  // Monthly amounts in roughly the proportions seen in the real payroll file.
  const usual = () =>
    faker.helpers.weightedArrayElement([
      { weight: 61, value: 5000 },
      { weight: 21, value: 10000 },
      { weight: 6, value: 20000 },
      { weight: 3, value: 15000 },
      { weight: 2, value: 7000 },
      { weight: 2, value: 50000 },
      { weight: 2, value: 6000 },
      { weight: 1, value: 30000 },
      { weight: 1, value: 100000 },
      { weight: 1, value: 8000 },
    ]);

  const history: (typeof savingsTransactions.$inferInsert)[] = [];
  for (let i = 0; i < TOTAL; i++) {
    if (i % 100 === 0) log(`  members ${i}/${TOTAL}…`);
    const joined = faker.date.between({ from: "2019-01-01", to: "2026-06-30" }).toISOString().slice(0, 10);
    const m = await createMember(
      SYSTEM,
      {
        fullName: `${faker.person.lastName()} ${faker.person.firstName()} ${faker.person.firstName()}`,
        employeeNo: unique(() => `EMP00${faker.string.numeric(5)}`),
        verificationNo: unique(() => `8612${faker.string.numeric(6)}`),
        phone: `0${faker.helpers.arrayElement(["803", "806", "813", "816", "703", "706", "810", "905", "802", "808"])}${faker.string.numeric(7)}`,
        email: faker.datatype.boolean(0.6) ? faker.internet.email().toLowerCase() : null,
        dateJoined: joined,
      },
      { allowDuplicate: true },
    );
    const roll = faker.number.float();
    let lastPeriod = "2026-09";
    if (roll < 0.05) {
      const exitDate = joined > "2026-03-31" ? joined : "2026-03-31";
      await changeMemberStatus(SYSTEM, m.id, { status: "exited", reason: "Left employment (seed)", dateExited: exitDate });
      lastPeriod = exitDate.slice(0, 7);
    } else if (roll < 0.06) {
      await changeMemberStatus(SYSTEM, m.id, { status: "suspended", reason: "Seed data" });
    }
    // Contribution history from Jan 2024 (or joining) to Sep 2026, with the odd missed month.
    const amount = usual();
    for (let p = joined.slice(0, 7) > "2024-01" ? joined.slice(0, 7) : "2024-01"; p <= lastPeriod; p = addMonths(p, 1)) {
      if (faker.number.float() < 0.03) continue;
      history.push({
        memberId: m.id,
        period: p,
        txnDate: `${p}-25`,
        type: "contribution",
        amountKobo: amount * 100,
        source: "seed",
        narration: "Payroll deduction (demo history)",
      });
    }
  }
  for (let i = 0; i < history.length; i += 2000) {
    await db.insert(savingsTransactions).values(history.slice(i, i + 2000));
  }
  log(`  ${TOTAL} members and ${history.length} contributions (Jan 2024 – Sep 2026)`);

  const [first] = await db.select().from(members).where(eq(members.status, "active")).limit(1);
  await createMemberLogin(SYSTEM, first.id, "Member!2026");
}

/** A payroll file in the bank's layout built from the register, with deliberate problems. */
export async function writeDemoBankFile(period: string, out: string) {
  const rows = await db.execute<{ employee_no: string; verification_no: string; status: string; usual: string | null }>(sql`
    select m.employee_no, m.verification_no, m.status,
           (select percentile_disc(0.5) within group (order by amount_kobo)
              from savings_transactions s where s.member_id = m.id and s.type = 'contribution') as usual
    from members m where m.employee_no is not null order by m.id`);
  const live = rows.rows.filter((r) => r.status === "active");
  const exited = rows.rows.find((r) => r.status === "exited");
  const file: { employmentNo: string | null; verificationNo?: string | null; amount: number | string | null }[] = live.map((r) => ({
    employmentNo: r.employee_no,
    verificationNo: r.verification_no,
    amount: r.usual ? Number(r.usual) / 100 : 5000,
  }));

  // Deliberate problems for the review screen:
  file[3].amount = Number(file[3].amount) * 6; // unusual amount (warning)
  file[7].amount = null; // blank amount
  file[11] = { ...file[11], employmentNo: "EMP0999999" }; // unknown number; verification no. still matches
  file.push({ ...file[15] }); // same member twice
  if (exited) file.push({ employmentNo: exited.employee_no, verificationNo: exited.verification_no, amount: 5000 });

  const buf = await buildKadunaPayrollFile({ monthLabel: formatPeriod(period).replace(/^(\w{3})\w*/, "$1"), rows: file });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, buf);
  return file.length;
}
