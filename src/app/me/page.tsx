import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/server/auth/session";
import { getMember } from "@/server/members";
import { logoutAction } from "../actions";

export const metadata = { title: "My account" };

/**
 * Member self-service. The member id comes from the session only — never
 * from the URL — so a member can only ever load their own record.
 */
export default async function MePage() {
  const user = await requirePermission("self.view");
  if (!user.memberId) redirect("/");
  const member = await getMember(user.memberId);
  if (!member) redirect("/forbidden");

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <span className="text-lg font-bold text-brand-700">Colowo</span>
        <form action={logoutAction}><button className="text-sm text-slate-600 hover:underline">Sign out</button></form>
      </header>

      <section className="card mb-4">
        <h1 className="text-xl font-semibold">{member.fullName}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
          <span className="font-mono">{member.memberNo}</span>
          <StatusBadge status={member.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <dt className="text-slate-500">Member since</dt><dd>{formatDate(member.dateJoined)}</dd>
          <dt className="text-slate-500">Employee no.</dt><dd className="font-mono">{member.employeeNo ?? "—"}</dd>
          <dt className="text-slate-500">Phone</dt><dd>{member.phone ?? "—"}</dd>
          <dt className="text-slate-500">Email</dt><dd className="break-all">{member.email ?? "—"}</dd>
        </dl>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card">
          <h2 className="text-sm font-medium text-slate-500">Savings balance</h2>
          <p className="mt-1 text-sm text-slate-400">Coming soon</p>
        </section>
        <section className="card">
          <h2 className="text-sm font-medium text-slate-500">Loan balance</h2>
          <p className="mt-1 text-sm text-slate-400">Coming soon</p>
        </section>
      </div>
    </div>
  );
}
