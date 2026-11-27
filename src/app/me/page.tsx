import { redirect } from "next/navigation";
import { MemberTransactionList, Passbook } from "@/components/savings";
import { StatusBadge } from "@/components/ui";
import { formatDate, formatKobo } from "@/lib/format";
import { requirePermission } from "@/server/auth/session";
import { getMember } from "@/server/members";
import { getPassbook, getSavingsBalance, listSavingsTransactions } from "@/server/savings/ledger";
import Link from "next/link";
import { LOAN_TYPE_LABEL, LoanStatusBadge } from "@/components/loans";
import { MemberShell } from "@/components/member-shell";
import { listApplications, listSchemes } from "@/server/loans/applications";

export const metadata = { title: "My account" };

/**
 * Member self-service. The member id comes from the session only — never
 * from the URL — so a member can only ever load their own record.
 */
export default async function MePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requirePermission("self.view");
  if (!user.memberId) redirect("/");
  const member = await getMember(user.memberId);
  if (!member) redirect("/forbidden");

  const [balance, passbook] = await Promise.all([getSavingsBalance(member.id), getPassbook(member.id)]);
  const years = passbook.map((y) => y.year);
  const requested = Number((await searchParams).year);
  const year = years.includes(requested) ? requested : years[0];
  const txns = year ? await listSavingsTransactions(member.id, { year }) : [];
  const current = passbook.find((y) => y.inProgress);
  const [applications, schemes] = await Promise.all([listApplications({ memberId: member.id }), listSchemes({ openOnly: true })]);
  const needsAnswer = applications.filter(({ app }) => app.status === "offered");

  return (
    <MemberShell>
      {needsAnswer.map(({ app }) => (
        <Link key={app.id} href={`/me/loans/${app.id}`} className="mb-4 block rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <strong>You have a loan offer waiting.</strong> Tap to review and accept, decline or ask for an adjustment →
        </Link>
      ))}

      <section className="mb-4">
        <h1 className="text-xl font-semibold">{member.fullName}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
          <span className="font-mono">{member.memberNo}</span>
          <StatusBadge status={member.status} />
          <span>Member since {formatDate(member.dateJoined)}</span>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card">
          <h2 className="text-sm font-medium text-slate-500">Savings balance</h2>
          <p className="mt-1 text-3xl font-semibold">{formatKobo(balance)}</p>
          {current && (
            <p className="mt-2 text-sm text-slate-600">
              Earnings {current.year} so far: <strong>{formatKobo(current.earningsKobo)}</strong>
            </p>
          )}
        </section>
        <section className="card">
          <h2 className="text-sm font-medium text-slate-500">Loans</h2>
          <p className="mt-1 text-sm text-slate-500">Loan balances appear here once a loan is paid out.</p>
          <Link href="/me/loans/apply" className="btn-primary mt-3 w-full">Apply for a loan</Link>
        </section>
      </div>

      {(applications.length > 0 || schemes.length > 0) && (
        <section className="card mt-4">
          <h2 className="mb-3 font-semibold">My loan applications</h2>
          {applications.length ? (
            <ul className="divide-y divide-slate-100">
              {applications.map(({ app, schemeName, offer }) => (
                <li key={app.id}>
                  <Link href={`/me/loans/${app.id}`} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{schemeName ?? LOAN_TYPE_LABEL[app.loanType]}</div>
                      <div className="text-xs text-slate-500">
                        Asked {formatKobo(app.requestedKobo)}
                        {offer && ` · offered ${formatKobo(Number(offer.amount_kobo))}`}
                      </div>
                    </div>
                    <LoanStatusBadge status={app.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No applications yet.</p>
          )}
          {schemes.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <h3 className="mb-2 text-sm font-medium text-slate-700">Loans open now</h3>
              <ul className="space-y-2">
                {schemes.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-slate-500">
                        {Number(s.defaultRatePercent)}% · {s.defaultTenureMonths} months{s.maxPerMemberKobo ? ` · up to ${formatKobo(s.maxPerMemberKobo)}` : ""}
                      </div>
                    </div>
                    <Link href={`/me/loans/apply?scheme=${s.id}`} className="btn-secondary px-3 py-1 text-xs">Apply</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="card mt-4">
        <h2 className="mb-3 font-semibold">Savings by year</h2>
        <Passbook years={passbook} />
      </section>

      {year && (
        <section className="card mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Transactions in {year}</h2>
            <form className="flex gap-2">
              <select name="year" defaultValue={year} className="input w-auto py-1">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button className="btn-secondary py-1">Show</button>
            </form>
          </div>
          <MemberTransactionList lines={txns} />
        </section>
      )}

      <section className="card mt-4 text-sm">
        <h2 className="mb-2 font-semibold">My details</h2>
        <dl className="grid grid-cols-2 gap-2">
          <dt className="text-slate-500">Employment no.</dt><dd className="font-mono">{member.employeeNo ?? "—"}</dd>
          <dt className="text-slate-500">Phone</dt><dd>{member.phone ?? "—"}</dd>
          <dt className="text-slate-500">Email</dt><dd className="break-all">{member.email ?? "—"}</dd>
        </dl>
        <p className="mt-3 text-xs text-slate-500">If anything looks wrong, contact the cooperative&apos;s finance office.</p>
      </section>
    </MemberShell>
  );
}
