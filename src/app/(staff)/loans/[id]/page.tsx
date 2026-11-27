import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cancelLoanAction, offerAction, rejectAction, respondAction } from "@/app/loan-actions";
import { OfferForm, ReasonForm, RespondForm } from "@/components/loan-forms";
import { LOAN_TYPE_LABEL, LoanStatusBadge, LoanTimeline, OfferTerms } from "@/components/loans";
import { PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, formatKobo } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { OPEN_STATUSES, defaultFirstRepayment, eligibilitySnapshot, getApplicationDetail } from "@/server/loans/applications";

export const metadata = { title: "Loan application" };

export default async function LoanApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const canManage = user.permissions.has("loan.manage");
  const canApprove = user.permissions.has("loan.approve");
  if (!canManage && !canApprove) redirect("/forbidden");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) notFound();
  const d = await getApplicationDetail(id);
  if (!d) notFound();
  const { app, member, scheme, currentOffer } = d;
  const elig = await eligibilitySnapshot(member.id, app.id);
  const ownApplication = user.memberId === member.id;
  const canDecide = canApprove && !ownApplication && ["submitted", "adjustment_requested", "offered"].includes(app.status);
  const lastAdjustment = d.events.find((e) => e.e.kind === "adjustment_requested");

  return (
    <>
      <PageHeader
        title={`Loan application #${app.id}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <LoanStatusBadge status={app.status} />
            <span>{scheme ? scheme.name : `General request — ${LOAN_TYPE_LABEL[app.loanType].toLowerCase()}`}</span>
            {app.onBehalf && <span>· entered by the office</span>}
          </span>
        }
        actions={<Link href="/loans" className="btn-secondary">Back to loans</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card">
            <h2 className="mb-3 font-semibold">Request</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <dt className="text-slate-500">Amount</dt><dd className="font-medium">{formatKobo(app.requestedKobo)}</dd>
              <dt className="text-slate-500">Months</dt><dd>{app.preferredTenureMonths ?? "—"}</dd>
            </dl>
            <p className="mt-2 text-sm text-slate-700">{app.purpose}</p>
            {app.status === "adjustment_requested" && lastAdjustment && (
              <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                <strong>Member asked for an adjustment:</strong> {lastAdjustment.e.note}
              </p>
            )}
          </section>

          {currentOffer && (
            <section className="card">
              <h2 className="mb-3 font-semibold">
                {currentOffer.response === "accepted" ? "Agreed terms" : currentOffer.response ? `Last offer (${currentOffer.response.replace("_", " ")})` : "Current offer"}
              </h2>
              <OfferTerms offer={currentOffer} />
            </section>
          )}

          {canDecide && (
            <section className="card">
              <h2 className="mb-3 font-semibold">{currentOffer ? "Send a revised offer" : "Make an offer"}</h2>
              <OfferForm
                action={offerAction.bind(null, app.id)}
                defaults={{
                  amountNaira: String((currentOffer?.amountKobo ?? app.requestedKobo) / 100),
                  ratePercent: String(Number(currentOffer?.ratePercent ?? scheme?.defaultRatePercent ?? "10")),
                  tenureMonths: currentOffer?.tenureMonths ?? app.preferredTenureMonths ?? scheme?.defaultTenureMonths ?? 10,
                  firstRepaymentPeriod: defaultFirstRepayment(),
                }}
              />
              <div className="mt-4 border-t border-slate-100 pt-3">
                <ReasonForm action={rejectAction.bind(null, app.id)} label="Reason (the member will see this)" button="Reject application" danger />
              </div>
            </section>
          )}
          {canApprove && ownApplication && OPEN_STATUSES.includes(app.status) && (
            <p className="text-sm text-amber-800">This is your own application, so another approver must decide it.</p>
          )}

          {canManage && app.status === "offered" && currentOffer && !currentOffer.response && (
            <section className="card">
              <h2 className="mb-3 font-semibold">Record the member&apos;s answer</h2>
              <RespondForm action={respondAction.bind(null, app.id)} onBehalfOf={member.fullName} />
            </section>
          )}

          {canManage && OPEN_STATUSES.includes(app.status) && (
            <ReasonForm action={cancelLoanAction.bind(null, app.id)} label="Reason (e.g. member's request)" button="Cancel on member's behalf" />
          )}

          <section className="card">
            <h2 className="mb-3 font-semibold">History</h2>
            <LoanTimeline events={d.events} showActors />
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card">
            <h2 className="mb-2 font-semibold">Member</h2>
            <Link href={`/members/${member.id}`} className="text-brand-700 hover:underline">{member.fullName}</Link>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
              <span className="font-mono">{member.memberNo}</span>
              <StatusBadge status={member.status} />
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Savings balance</dt><dd className="font-medium">{formatKobo(elig.savingsKobo)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Member for</dt><dd>{Math.floor(elig.monthsOfMembership / 12)} yr {elig.monthsOfMembership % 12} mo</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Joined</dt><dd>{formatDate(member.dateJoined)}</dd></div>
            </dl>
          </section>
          <section className="card">
            <h2 className="mb-2 font-semibold">Other applications</h2>
            {elig.otherApplications.length ? (
              <ul className="space-y-2 text-sm">
                {elig.otherApplications.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <Link href={`/loans/${o.id}`} className="hover:underline">#{o.id} · {formatKobo(o.requestedKobo)}</Link>
                    <LoanStatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">None.</p>
            )}
            <p className="mt-3 text-xs text-slate-400">Active loan balances appear here once payouts are recorded.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
