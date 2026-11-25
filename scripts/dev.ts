/**
 * `npm run dev` — one command to try Colowo locally:
 *   1. starts the built-in database (unless DATABASE_URL points elsewhere)
 *   2. applies migrations
 *   3. loads demo data the first time
 *   4. writes a demo bank file to demo-files/
 *   5. starts Next.js on http://localhost:3000
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureDevSessionSecret, loadEnv, startLocalDatabase, wantsLocalDatabase } from "./lib/local-db";

async function main() {
  loadEnv();
  ensureDevSessionSecret();

  let stopDb: (() => Promise<void>) | null = null;
  if (wantsLocalDatabase()) {
    const local = await startLocalDatabase();
    process.env.DATABASE_URL = local.url;
    stopDb = local.stop;
    console.log(`• Local database running (data in .data/postgres)`);
  } else {
    console.log("• Using DATABASE_URL from .env.local");
  }

  const tasks = await import("./lib/tasks");
  await tasks.runMigrations();
  console.log("• Database up to date");
  if ((await tasks.memberCount()) === 0) {
    console.log("• Loading demo data (first run only, about a minute)…");
    await tasks.seedDemo((s) => console.log(s));
  }
  const demoFile = path.join("demo-files", "bank-file-october-2026.xlsx");
  if (!existsSync(demoFile)) await tasks.writeDemoBankFile("2026-10", demoFile);
  await tasks.pool.end();

  console.log(`
  Colowo is starting on http://localhost:3000

  Staff:   finance@colowo.local / Colowo!2026   (imports)
           admin@colowo.local   / Colowo!2026   (everything)
  Member:  CLW00001             / Member!2026   (asks for a new password)

  Demo bank file to upload: ${demoFile}  (choose October 2026)
  Press Ctrl+C to stop.
`);

  const next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });

  let stopping = false;
  const shutdown = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    next.kill("SIGINT");
    if (stopDb) await stopDb().catch(() => {});
    process.exit(code);
  };
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  next.on("exit", (code) => void shutdown(code ?? 0));
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
