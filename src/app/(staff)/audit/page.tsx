import { AuditTable } from "@/components/audit-table";
import { PageHeader } from "@/components/ui";
import { listAudit } from "@/server/audit-queries";
import { requirePermission } from "@/server/auth/session";

export const metadata = { title: "Audit log" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; entityId?: string; from?: string; to?: string }>;
}) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const clean = (s?: string) => s?.trim() || undefined;
  const ymd = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const rows = await listAudit({
    action: clean(sp.action),
    entityType: clean(sp.entityType),
    entityId: clean(sp.entityId),
    from: ymd(sp.from),
    to: ymd(sp.to),
  });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change to members, users and (later) money. Entries can never be edited or deleted." />
      <form className="mb-4 grid gap-2 sm:grid-cols-6">
        <input name="action" defaultValue={sp.action} placeholder="Action, e.g. member.exit" className="input sm:col-span-2" />
        <input name="entityType" defaultValue={sp.entityType} placeholder="Record type" className="input" />
        <input name="from" type="date" defaultValue={sp.from} className="input" aria-label="From" />
        <input name="to" type="date" defaultValue={sp.to} className="input" aria-label="To" />
        <button className="btn-secondary">Filter</button>
      </form>
      <div className="card p-0">
        <AuditTable rows={rows} />
      </div>
      {rows.length === 200 && <p className="mt-2 text-sm text-slate-500">Showing the latest 200 entries. Narrow the filter to see more.</p>}
    </>
  );
}
