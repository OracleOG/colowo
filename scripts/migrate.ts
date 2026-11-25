/** Apply pending migrations: `npm run db:migrate` (uses the built-in local database if DATABASE_URL isn't set). */
import { withDatabase } from "./lib/local-db";

withDatabase(async () => {
  const tasks = await import("./lib/tasks");
  await tasks.runMigrations();
  await tasks.pool.end();
  console.log("Migrations applied.");
}).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
