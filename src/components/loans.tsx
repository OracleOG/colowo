import type { LoanApplication, LoanOffer } from "@/db/schema";
import { formatDate, formatDateTime, formatKobo } from "@/lib/format";
import { formatPeriod } from "@/lib/period";

export const LOAN_TYPE_LABEL: Record<LoanApplication["loanType"], string> = {
  regular: "Regular loan",
  commodity: "Commodity loan",
  special: "Special loan",
};

const STATUS: Record<LoanApplication["status"], { label: string; style: string }> = {
  submitted: { label: "Waiting for review", style: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  offered: { label: "Offer made", style: "bg-sky-50 text-sky-800 ring-sky-600/20" },
  adjustment_requested: { label: "Adjustment requested", style: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  accepted: { label: "Accepted — awaiting payment", style: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  declined: { label: "Declined", style: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  rejected: { label: "Not approved", style: "bg-red-50 text-red-700 ring-red-600/20" },
  cancelled: { label: "Cancelled", style: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  disbursed: { label: "Paid out", style: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
};

export function LoanStatusBadge({ status }: { status: LoanApplication["status"] }) {
  const s = STATUS[status];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${s.style}`}>{s.label}</span>;
}

/** The terms of an offer, laid out for a phone first. */
export function OfferTerms({ offer }: { offer: LoanOffer }) {
  const rows: [string, React.ReactNode][] = [
    ["Amount you receive", <strong key="a">{formatKobo(offer.amountKobo)}</strong>],
    [`Interest (${Number(offer.ratePercent)}%)`, formatKobo(offer.interestKobo)],
    ["Total to repay", <strong key="t">{formatKobo(offer.totalKobo)}</strong>],
    ["Monthly repayment", `${formatKobo(offer.instalmentKobo)} × ${offer.tenureMonths} months`],
    ["First repayment", formatPeriod(offer.firstRepaymentPeriod)],
  ];
  return (
    <div>
      <dl className="divide-y divide-slate-100 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {offer.conditions && <p className="mt-2 rounded-md bg-slate-50 p-2 text-sm text-slate-700">{offer.conditions}</p>}
      <p className="mt-2 text-xs text-slate-500">
        Offer {offer.version > 1 ? `(revision ${offer.version}) ` : ""}valid until {formatDate(offer.validUntil)}.
        {offer.tenureMonths > 1 && offer.instalmentKobo * offer.tenureMonths !== offer.totalKobo && " The last month is slightly less."}
      </p>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  applied: "Applied",
  offered: "Offer made",
  offer_withdrawn: "Earlier offer replaced",
  accepted: "Offer accepted",
  declined: "Offer declined",
  adjustment_requested: "Asked for an adjustment",
  rejected: "Not approved",
  cancelled: "Cancelled",
};

export function LoanTimeline({
  events,
  showActors,
}: {
  events: { e: { id: number; kind: string; note: string | null; at: Date; onBehalf: boolean }; actorName: string | null }[];
  showActors: boolean;
}) {
  return (
    <ol className="space-y-3">
      {events.map(({ e, actorName }) => (
        <li key={e.id} className="border-l-2 border-slate-200 pl-3">
          <div className="text-sm font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</div>
          {e.note && <div className="text-sm text-slate-600">{e.note}</div>}
          <div className="text-xs text-slate-400">
            {formatDateTime(e.at)}
            {showActors && actorName && ` · ${actorName}`}
            {e.onBehalf && " · on the member's behalf"}
          </div>
        </li>
      ))}
    </ol>
  );
}
