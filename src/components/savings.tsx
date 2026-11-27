import type { SavingsTxn } from "@/db/schema";
import { formatDate, formatKobo } from "@/lib/format";
import { formatPeriod } from "@/lib/period";
import type { LedgerLine, PassbookYear } from "@/server/savings/ledger";

const TYPE_LABEL: Record<SavingsTxn["type"], string> = {
  contribution: "Contribution",
  withdrawal: "Withdrawal",
  adjustment: "Adjustment",
  reversal: "Reversal",
  migrated_opening: "Opening balance (migrated)",
};

const SOURCE_LABEL: Record<SavingsTxn["source"], string> = {
  import: "Payroll",
  manual: "Manual",
  migration: "Migration",
  seed: "Demo data",
};

/** Yearly summary in the familiar passbook shape. */
export function Passbook({ years }: { years: PassbookYear[] }) {
  if (!years.length) return <p className="text-sm text-slate-500">No savings recorded yet.</p>;
  return (
    <div>
      {/* Phones: one card per year */}
      <ul className="space-y-3 sm:hidden">
        {years.map((y) => (
          <li key={y.year} className="rounded-md border border-slate-200 p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{y.year}</span>
              <span className="text-lg font-semibold">{formatKobo(y.closingKobo)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Opening</dt><dd className="text-right">{formatKobo(y.openingKobo)}</dd>
              <dt className="text-slate-500">Contributions</dt><dd className="text-right">{formatKobo(y.contributionsKobo)}</dd>
              {y.withdrawalsKobo !== 0 && (<><dt className="text-slate-500">Withdrawals</dt><dd className="text-right">{formatKobo(y.withdrawalsKobo)}</dd></>)}
              {y.adjustmentsKobo !== 0 && (<><dt className="text-slate-500">Adjustments</dt><dd className="text-right">{formatKobo(y.adjustmentsKobo)}</dd></>)}
              <dt className="text-slate-500">Earnings{y.inProgress ? " (to date)" : ""}</dt><dd className="text-right">{formatKobo(y.earningsKobo)}</dd>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
      <table className="table">
        <thead>
          <tr>
            <th>Year</th>
            <th className="text-right">Opening</th>
            <th className="text-right">Contributions</th>
            <th className="text-right">Withdrawals</th>
            <th className="text-right">Adjustments</th>
            <th className="text-right">Closing</th>
            <th className="text-right">Earnings</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year}>
              <td className="font-medium">{y.year}</td>
              <td className="text-right whitespace-nowrap">{formatKobo(y.openingKobo)}</td>
              <td className="text-right whitespace-nowrap">{formatKobo(y.contributionsKobo)}</td>
              <td className="text-right whitespace-nowrap">{y.withdrawalsKobo ? formatKobo(y.withdrawalsKobo) : "—"}</td>
              <td className="text-right whitespace-nowrap">{y.adjustmentsKobo ? formatKobo(y.adjustmentsKobo) : "—"}</td>
              <td className="text-right font-medium whitespace-nowrap">{formatKobo(y.closingKobo)}</td>
              <td className="text-right whitespace-nowrap">
                {formatKobo(y.earningsKobo)}
                {y.inProgress && <span className="block text-xs text-slate-500">to date</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Earnings follow the cooperative&apos;s rule: monthly interest on the running balance, restarting from savings each January.
        They are not added to the savings balance. The amount actually paid each year is a percentage the cooperative sets.
      </p>
    </div>
  );
}

/** Phone-friendly list for members: no staff names or internal links. */
export function MemberTransactionList({ lines }: { lines: LedgerLine[] }) {
  if (!lines.length) return <p className="text-sm text-slate-500">No transactions.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {lines.map((t) => (
        <li key={t.id} className={`flex items-start justify-between gap-3 py-2.5 ${t.reversedById || t.type === "reversal" ? "text-slate-400" : ""}`}>
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {formatPeriod(t.period)} · {TYPE_LABEL[t.type]}
              {t.reversedById && <span className="ml-1 text-xs font-normal">(reversed)</span>}
            </div>
            <div className="truncate text-xs text-slate-500">{t.source === "import" ? "Payroll deduction" : t.narration}</div>
          </div>
          <div className={`text-sm whitespace-nowrap ${t.amountKobo < 0 ? "text-red-700" : ""}`}>{formatKobo(t.amountKobo)}</div>
        </li>
      ))}
    </ul>
  );
}

export function TransactionList({
  lines,
  renderAction,
  staffLinks = false,
}: {
  lines: LedgerLine[];
  renderAction?: (line: LedgerLine) => React.ReactNode;
  /** Link payroll rows to their import batch (staff only). */
  staffLinks?: boolean;
}) {
  if (!lines.length) return <p className="text-sm text-slate-500">No transactions.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Type</th>
            <th>Details</th>
            <th className="text-right">Amount</th>
            {renderAction && <th></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((t) => (
            <tr key={t.id} className={t.reversedById || t.type === "reversal" ? "text-slate-400" : undefined}>
              <td className="whitespace-nowrap">{formatPeriod(t.period)}</td>
              <td className="whitespace-nowrap">
                {TYPE_LABEL[t.type]}
                {t.reversedById && <span className="ml-1 text-xs">(reversed)</span>}
              </td>
              <td className="text-xs">
                <span className="text-slate-600">{t.narration}</span>
                <span className="block text-slate-400">
                  {SOURCE_LABEL[t.source]}
                  {t.batchId && staffLinks && <> · <a href={`/imports/${t.batchId}`} className="hover:underline">import #{t.batchId}</a></>}
                  {" · "}
                  {formatDate(t.txnDate)}
                  {t.createdByName && ` · ${t.createdByName}`}
                </span>
              </td>
              <td className={`text-right whitespace-nowrap ${t.amountKobo < 0 ? "text-red-700" : ""}`}>{formatKobo(t.amountKobo)}</td>
              {renderAction && <td>{renderAction(t)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
