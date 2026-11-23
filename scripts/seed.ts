/**
 * Development seed: roles/permissions, demo staff logins and ~500 fake members.
 * `npm run db:seed` — safe to re-run (skips what already exists).
 * Never run against production.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { fakerEN_NG: faker } = await import("@faker-js/faker");
  const { count, eq } = await import("drizzle-orm");
  const { db, pool } = await import("../src/db");
  const { members, savingsTransactions, users } = await import("../src/db/schema");
  const { addMonths } = await import("../src/lib/period");
  const { syncRolesAndPermissions } = await import("../src/server/auth/roles");
  const { createUser, createMemberLogin } = await import("../src/server/auth/users");
  const { createMember, changeMemberStatus } = await import("../src/server/members");
  const { SYSTEM } = await import("../src/server/audit");

  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed production");

  await db.transaction((tx) => syncRolesAndPermissions(tx));
  console.log("Roles and permissions synced.");

  const staff = [
    { login: "admin@colowo.local", displayName: "Demo Admin", roleCodes: ["admin"] },
    { login: "finance@colowo.local", displayName: "Demo Finance Officer", roleCodes: ["finance_officer"] },
    { login: "board@colowo.local", displayName: "Demo Board Viewer", roleCodes: ["viewer"] },
  ];
  for (const s of staff) {
    const [exists] = await db.select().from(users).where(eq(users.login, s.login));
    if (!exists) {
      await createUser(SYSTEM, { ...s, password: "Colowo!2026", mustChangePassword: false });
      console.log(`Created ${s.login}`);
    }
  }

  const [{ n }] = await db.select({ n: count() }).from(members);
  if (n === 0) {
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
      let p = joined.slice(0, 7) > "2024-01" ? joined.slice(0, 7) : "2024-01";
      for (; p <= lastPeriod; p = addMonths(p, 1)) {
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
    console.log(`Created ${TOTAL} members and ${history.length} historical contributions (Jan 2024 – Sep 2026).`);

    const [first] = await db.select().from(members).where(eq(members.status, "active")).limit(1);
    await createMemberLogin(SYSTEM, first.id, "Member!2026");
    console.log(`Member login: ${first.memberNo} / Member!2026 (must change on first login)`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
