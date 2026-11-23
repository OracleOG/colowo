/**
 * Generate a demo bank file in the Kaduna payroll layout from the member register.
 *   npm run demo:bank-file -- 2026-10 ./october.xlsx
 * Includes a handful of realistic problems so the review screen has work to do.
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const [period = "2026-10", out = `bank-file-${period}.xlsx`] = process.argv.slice(2);
  const { sql } = await import("drizzle-orm");
  const { db, pool } = await import("../src/db");
  const { buildKadunaPayrollFile } = await import("../src/server/imports/sample-file");
  const { formatPeriod } = await import("../src/lib/period");

  const rows = await db.execute<{ employee_no: string; verification_no: string; status: string; usual: string | null }>(sql`
    select m.employee_no, m.verification_no, m.status,
           (select percentile_disc(0.5) within group (order by amount_kobo)
              from savings_transactions s where s.member_id = m.id and s.type = 'contribution') as usual
    from members m where m.employee_no is not null order by m.id`);
  const live = rows.rows.filter((r) => r.status === "active");
  const exited = rows.rows.find((r) => r.status === "exited");
  const file = live.map((r) => ({
    employmentNo: r.employee_no,
    verificationNo: r.verification_no,
    amount: r.usual ? Number(r.usual) / 100 : 5000,
  })) as { employmentNo: string | null; verificationNo?: string | null; amount: number | string | null }[];

  // Deliberate problems:
  file[3].amount = Number(file[3].amount) * 6; // unusual amount (warning)
  file[7].amount = null; // blank amount
  file[11] = { ...file[11], employmentNo: "EMP0999999" }; // unknown number, but verification no. still matches
  file.push({ ...file[15] }); // same member twice
  if (exited) file.push({ employmentNo: exited.employee_no, verificationNo: exited.verification_no, amount: 5000 });

  const buf = await buildKadunaPayrollFile({ monthLabel: formatPeriod(period).replace(/^(\w{3})\w*/, "$1"), rows: file });
  writeFileSync(out, buf);
  console.log(`Wrote ${out}: ${file.length} rows for ${formatPeriod(period)}.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
