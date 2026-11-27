import { notFound, redirect } from "next/navigation";
import { cancelLoanAction, respondAction } from "@/app/loan-actions";
import { ReasonForm, RespondForm } from "@/components/loan-forms";
import { LOAN_TYPE_LABEL, LoanStatusBadge, LoanTimeline, OfferTerms } from "@/components/loans";
import { MemberShell } from "@/components/member-shell";
import { Alert } from "@/components/ui";
import { formatKobo } from "@/lib/format";
import { requirePermission } from "@/server/auth/session";
import { OPEN_STATUSES, getApplicationDetail } from "@/server/loans/applications";

export const metadata = { title: "My loan application" };

export default async function MemberLoanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ applied?: string }>;
}) {
  const user = await requirePermission("self.view");
  if (!user.memberId) redirect("/");
  const d = await getApplicationDetail(Number((await params).id));
  // Members only ever see their own applications.
  if (!d || d.app.memberId !== user.memberId) notFound();
  const { app, scheme, currentOffer } = d;
  const waitingForMe = app.status === "offered" && currentOffer && !currentOffer.response;
  const rejected = d.events.find((e) => e.e.kind === "rejected");

  return (
    <MemberShell back={{ href: "/me", label: "My account" }}>
      {(await searchParams).applied && (
        <div className="mb-4"><Alert kind="success">Application sent. You&apos;ll see the offer here once the loan office has reviewed it.</Alert></div>
      )}
      <div className="mb-4">
        <h1 className="text-xl font-semibold">{scheme ? scheme.name : LOAN_TYPE_LABEL[app.loanType]}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <LoanStatusBadge status={app.status} />
          <span>Requested {formatKobo(app.requestedKobo)}</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">{app.purpose}</p>
      </div>

      {rejected && app.status === "rejected" && (
        <div className="mb-4"><Alert>Not approved: {rejected.e.note}</Alert></div>
      )}

      {currentOffer && (
        <section className="card mb-4">
          <h2 className="mb-2 font-semibold">
            {waitingForMe ? "Your offer" : currentOffer.response === "accepted" ? "Agreed terms" : "Last offer"}
          </h2>
          <OfferTerms offer={currentOffer} />
          {waitingForMe && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <RespondForm action={respondAction.bind(null, app.id)} />
            </div>
          )}
          {app.status === "adjustment_requested" && (
            <p className="mt-3 text-sm text-amber-800">You asked for an adjustment. The loan office will send a revised offer.</p>
          )}
          {app.status === "accepted" && (
            <p className="mt-3 text-sm text-emerald-700">You accepted this offer. The loan office will arrange payment.</p>
          )}
        </section>
      )}
      {app.status === "submitted" && (
        <section className="card mb-4 text-sm text-slate-600">The loan office is reviewing your application.</section>
      )}

      <section className="card mb-4">
        <h2 className="mb-3 font-semibold">History</h2>
        <LoanTimeline events={d.events} showActors={false} />
      </section>

      {OPEN_STATUSES.includes(app.status) && (
        <ReasonForm action={cancelLoanAction.bind(null, app.id)} label="Reason (optional)" button="Cancel this application" />
      )}
    </MemberShell>
  );
}
