import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Empty all data tables (test database only). Append-only triggers are bypassed
 * for this session by switching to replica mode — production code can't do this.
 */
export async function resetDb() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`truncate loan_events, loan_offers, loan_applications, loan_schemes, savings_transactions, import_rows, import_batches, stored_files,
      audit_log, user_roles, users, members restart identity cascade`);
    // earning_rates is emptied by the cascade (created_by → users); restore the migration's defaults.
    await tx.execute(sql`insert into earning_rates (effective_from, monthly_rate, note)
      values ('2019-01', 0.0042, 'test'), ('2022-01', 0.005, 'test') on conflict do nothing`);
  });
}
