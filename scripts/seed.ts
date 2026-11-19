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
  const { members, users } = await import("../src/db/schema");
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
    const usedEmp = new Set<string>();
    for (let i = 0; i < TOTAL; i++) {
      let emp: string;
      do emp = String(faker.number.int({ min: 100000, max: 999999 }));
      while (usedEmp.has(emp));
      usedEmp.add(emp);
      const joined = faker.date.between({ from: "2019-01-01", to: "2026-06-30" });
      const m = await createMember(
        SYSTEM,
        {
          fullName: `${faker.person.lastName()} ${faker.person.firstName()} ${faker.person.firstName()}`,
          employeeNo: emp,
          phone: `0${faker.helpers.arrayElement(["803", "806", "813", "816", "703", "706", "810", "905", "802", "808"])}${faker.string.numeric(7)}`,
          email: faker.datatype.boolean(0.6) ? faker.internet.email().toLowerCase() : null,
          dateJoined: joined.toISOString().slice(0, 10),
        },
        { allowDuplicate: true },
      );
      const roll = faker.number.float();
      if (roll < 0.05) {
        await changeMemberStatus(SYSTEM, m.id, {
          status: "exited",
          reason: "Left employment (seed)",
          dateExited: "2026-09-30" > m.dateJoined ? "2026-09-30" : m.dateJoined,
        });
      } else if (roll < 0.06) {
        await changeMemberStatus(SYSTEM, m.id, { status: "suspended", reason: "Seed data" });
      }
    }
    console.log(`Created ${TOTAL} members.`);

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
