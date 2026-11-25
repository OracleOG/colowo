/** `npm run db:reset` — delete the built-in local database and demo files, to start fresh. */
import { existsSync, rmSync } from "node:fs";

for (const dir of [".data/postgres", "demo-files"]) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
console.log("Local database removed. Run `npm run dev` to set it up again with fresh demo data.");
