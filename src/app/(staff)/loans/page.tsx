import Link from "next/link";
import { redirect } from "next/navigation";
import { LOAN_TYPE_LABEL, LoanStatusBadge } from "@/components/loans";
import { PageHeader } from "@/components/ui";
import { formatDateTime, formatKobo } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { listApplications, queueCounts } from "@/server/loans/applications";

export const metadata = { title: "Loans" };

const QUEUES = [
  { key: "action", label: "Needs a decision" },
  { key: "offered", label: "Waiting for member" },
  { key: "accepted", label: "Accepted — to pay out" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  if (!user.permissions.has("loan.manage") && !user.permissions.has("loan.approve")) redirect("/forbidden");
  const sp = await searchParams;
  const queue = (QUEUES.find((q) => q.key === sp.q)?.key ?? "action") as (typeof QUEUES)[number]["key"];
  const [rows, counts] = await Promise.all([listApplications({ queue }), queueCounts()]);

  return (
    <>
      <PageHeader
        title="Loans"
        subtitle="Applications from members, or made by staff on a member's behalf."
        actions={
          <>
            <Link href="/loans/schemes" className="btn-secondary">Loan schemes</Link>
            {user.permissions.has("loan.manage") && <Link href="/members" className="btn-primary">Apply for a member</Link>}
          </>
        }
      />
      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {QUEUES.map((q) => (
          <Link
            key={q.key}
            href={`?q=${q.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${queue === q.key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {q.label} {q.key !== "all" && <span className="text-slate-400">{counts[q.key]}</span>}
          </Link>
        ))}
      </nav>
      <div className="card overflow-x-auto rounded-t-none p-0">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Member</th>
              <th>Loan</th>
              <th className="text-right">Requested</th>
              <th className="text-right">Offered</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ app, memberNo, memberName, schemeName, offer }) => (
              <tr key={app.id} className="hover:bg-slate-50">
                <td><Link href={`/loans/${app.id}`} className="text-brand-700 hover:underline">#{app.id}</Link></td>
                <td><span className="font-mono text-xs text-slate-500">{memberNo}</span> {memberName}</td>
                <td className="text-sm">{schemeName ?? `General — ${LOAN_TYPE_LABEL[app.loanType].toLowerCase()}`}</td>
                <td className="text-right whitespace-nowrap">{formatKobo(app.requestedKobo)}</td>
                <td className="text-right whitespace-nowrap">{offer ? `${formatKobo(Number(offer.amount_kobo))} / ${offer.tenure_months} mo` : "—"}</td>
                <td><LoanStatusBadge status={app.status} />{app.onBehalf && <span className="ml-1 text-xs text-slate-400">(office)</span>}</td>
                <td className="text-xs whitespace-nowrap text-slate-500">{formatDateTime(app.updatedAt)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-10 text-center text-slate-500">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
