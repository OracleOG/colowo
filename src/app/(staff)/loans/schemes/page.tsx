import Link from "next/link";
import { redirect } from "next/navigation";
import { createSchemeAction, schemeStatusAction } from "@/app/loan-actions";
import { SchemeForm } from "@/components/loan-forms";
import { LOAN_TYPE_LABEL } from "@/components/loans";
import { PageHeader } from "@/components/ui";
import { formatDate, formatKobo, todayLagos } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { listSchemes } from "@/server/loans/applications";

export const metadata = { title: "Loan schemes" };

export default async function SchemesPage() {
  const user = await requireUser();
  if (!user.permissions.has("loan.manage") && !user.permissions.has("loan.approve")) redirect("/forbidden");
  const canManage = user.permissions.has("loan.approve");
  const schemes = await listSchemes();
  return (
    <>
      <PageHeader
        title="Loan schemes"
        subtitle="Loans the cooperative advertises when money is available. Members can also make general requests without a scheme."
        actions={<Link href="/loans" className="btn-secondary">Back to loans</Link>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {schemes.map((s) => (
          <section key={s.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{s.name}</h2>
                <p className="text-xs text-slate-500">{LOAN_TYPE_LABEL[s.type]} · {Number(s.defaultRatePercent)}% · {s.defaultTenureMonths} months</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.isOpen ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {s.isOpen ? "Open" : s.status === "closed" ? "Closed" : "Not open now"}
              </span>
            </div>
            {s.description && <p className="mt-2 text-sm text-slate-600">{s.description}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">
              <dt className="text-slate-500">Window</dt><dd>{formatDate(s.opensOn)} – {s.closesOn ? formatDate(s.closesOn) : "no end date"}</dd>
              <dt className="text-slate-500">Max per member</dt><dd>{s.maxPerMemberKobo ? formatKobo(s.maxPerMemberKobo) : "—"}</dd>
              <dt className="text-slate-500">Money available</dt><dd>{s.poolKobo ? formatKobo(s.poolKobo) : "—"}</dd>
              <dt className="text-slate-500">Accepted so far</dt>
              <dd>
                {formatKobo(s.committedKobo)}
                {s.poolKobo ? <span className="text-slate-500"> ({Math.round((s.committedKobo / s.poolKobo) * 100)}%)</span> : null}
              </dd>
              <dt className="text-slate-500">Applications</dt><dd>{s.applications}</dd>
            </dl>
            {canManage && (
              <form action={schemeStatusAction.bind(null, s.id, s.status === "open" ? "closed" : "open")} className="mt-3">
                <button className="btn-secondary text-xs">{s.status === "open" ? "Close scheme" : "Reopen scheme"}</button>
              </form>
            )}
          </section>
        ))}
        {!schemes.length && <p className="text-sm text-slate-500">No schemes yet.</p>}
      </div>
      {canManage && (
        <section className="card mt-6 max-w-2xl">
          <h2 className="mb-4 font-semibold">Open a new scheme</h2>
          <SchemeForm action={createSchemeAction} today={todayLagos()} />
        </section>
      )}
    </>
  );
}
