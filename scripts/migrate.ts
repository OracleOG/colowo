/** Apply pending migrations: `npm run db:migrate` */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { db, pool } = await import("../src/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
