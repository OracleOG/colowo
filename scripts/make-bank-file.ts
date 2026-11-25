/**
 * Generate a demo bank file in the Kaduna payroll layout from the member register.
 *   npm run demo:bank-file -- 2026-11 ./demo-files/november.xlsx
 */
import { withDatabase } from "./lib/local-db";

const [period = "2026-10", out = `demo-files/bank-file-${period}.xlsx`] = process.argv.slice(2);

withDatabase(async () => {
  const tasks = await import("./lib/tasks");
  const n = await tasks.writeDemoBankFile(period, out);
  await tasks.pool.end();
  console.log(`Wrote ${out} (${n} rows).`);
}).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
