/**
 * Load demo data: `npm run db:seed` (never in production).
 * `npm run dev` does this automatically on first run.
 */
import { withDatabase } from "./lib/local-db";

withDatabase(async () => {
  const tasks = await import("./lib/tasks");
  await tasks.runMigrations();
  await tasks.seedDemo();
  await tasks.pool.end();
  console.log("Demo data loaded.");
}).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
