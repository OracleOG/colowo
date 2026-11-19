import Link from "next/link";
import type { Member } from "@/db/schema";
import { PageHeader, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/server/auth/session";
import { memberStatusCounts, searchMembers } from "@/server/members";

export const metadata = { title: "Members" };

const STATUSES = ["all", "active", "suspended", "exited"] as const;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const user = await requirePermission("member.view");
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as Member["status"] | "all") : "active";
  const [result, counts] = await Promise.all([
    searchMembers({ q: sp.q, status, page: Number(sp.page) || 1 }),
    memberStatusCounts(),
  ]);
  const qs = (page: number) => `?${new URLSearchParams({ q: sp.q ?? "", status, page: String(page) })}`;

  return (
    <>
      <PageHeader
        title="Members"
        subtitle={`${counts.active ?? 0} active · ${counts.suspended ?? 0} suspended · ${counts.exited ?? 0} exited`}
        actions={
          user.permissions.has("member.manage") && (
            <Link href="/members/new" className="btn-primary">Add member</Link>
          )
        }
      />

      <form className="mb-4 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={sp.q}
          placeholder="Search name, member no., employee no. or phone"
          className="input max-w-md flex-1"
        />
        <select name="status" defaultValue={status} className="input w-auto">
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <button className="btn-secondary">Search</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Member no.</th>
              <th>Name</th>
              <th>Employee no.</th>
              <th>Phone</th>
              <th>Joined</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="font-mono">
                  <Link href={`/members/${m.id}`} className="text-brand-700 hover:underline">{m.memberNo}</Link>
                </td>
                <td>{m.fullName}</td>
                <td className="font-mono">{m.employeeNo ?? "—"}</td>
                <td>{m.phone ?? "—"}</td>
                <td>{formatDate(m.dateJoined)}</td>
                <td><StatusBadge status={m.status} /></td>
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-slate-500">No members found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <span>{result.total} member{result.total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          {result.page > 1 && <Link className="btn-secondary" href={qs(result.page - 1)}>Previous</Link>}
          <span>Page {result.page} of {result.pages}</span>
          {result.page < result.pages && <Link className="btn-secondary" href={qs(result.page + 1)}>Next</Link>}
        </div>
      </div>
    </>
  );
}
