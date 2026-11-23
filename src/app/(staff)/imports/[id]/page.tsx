import Link from "next/link";
import { notFound } from "next/navigation";
import { BatchStatusBadge, RowOutcome } from "@/components/import-ui";
import { Alert, PageHeader } from "@/components/ui";
import { describeCode } from "@/lib/import-codes";
import { formatDateTime, formatKobo } from "@/lib/format";
import { formatPeriod } from "@/lib/period";
import { requirePermission } from "@/server/auth/session";
import { getBatchSummary, listBatchRows, type RowFilter } from "@/server/imports/service";
import { CancelForm, CommitPanel, RowActions } from "./batch-forms";

export const metadata = { title: "Review import" };

const TABS: { key: RowFilter; label: string }[] = [
  { key: "exceptions", label: "Exceptions" },
  { key: "ok", label: "Ready" },
  { key: "warning", label: "Warnings" },
  { key: "skipped", label: "Skipped" },
  { key: "posted", label: "Posted" },
  { key: "all", label: "All rows" },
];

function Stat({ label, count, kobo, tone = "slate" }: { label: string; count: number; kobo: number; tone?: string }) {
  const color = { slate: "text-slate-900", green: "text-emerald-700", red: "text-red-700", amber: "text-amber-700" }[tone];
  return (
    <div className="card p-4">
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{count}</div>
      <div className="text-sm text-slate-600">{formatKobo(kobo)}</div>
    </div>
  );
}

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await requirePermission("import.upload");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) notFound();
  const summary = await getBatchSummary(id);
  if (!summary) notFound();
  const { batch: b, counts, totals } = summary;

  const sp = await searchParams;
  const outstanding = counts.error + counts.warning + (b.status === "committed" ? counts.ok : 0);
  const defaultTab: RowFilter = outstanding > 0 ? "exceptions" : b.status === "committed" ? "posted" : "all";
  const tab = (TABS.find((t) => t.key === sp.show)?.key ?? defaultTab) as RowFilter;
  const rows = await listBatchRows(id, tab);
  const tabCount: Record<RowFilter, number> = {
    exceptions: counts.error + counts.warning + (b.status === "committed" ? counts.ok : 0),
    ok: counts.ok,
    warning: counts.warning,
    skipped: counts.skipped,
    posted: counts.posted,
    all: counts.total,
  };

  const canEdit = b.status !== "cancelled";
  const canCommit = user.permissions.has("import.commit");
  // Compare the Grand Total with the file as received — corrections made afterwards don't count.
  const controlOk =
    b.controlTotalKobo === null ||
    (b.controlTotalKobo === b.parsedTotalKobo && (b.controlCount === null || b.controlCount === b.parsedCount));

  return (
    <>
      <PageHeader
        title={`${formatPeriod(b.period)} deductions`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <BatchStatusBadge status={b.status} />
            <span>Import #{b.id}</span>·<span>{b.fileName}</span>·
            <span>uploaded {formatDateTime(b.createdAt)} by {summary.uploadedByName}</span>
            {b.committedAt && <span>· committed {formatDateTime(b.committedAt)} by {summary.committedByName}</span>}
          </span>
        }
        actions={
          <>
            <a href={`/imports/${id}/file`} className="btn-secondary">Original file</a>
            {user.permissions.has("report.view") && <a href={`/imports/${id}/report`} className="btn-secondary">Status report (.xlsx)</a>}
          </>
        }
      />

      <div className="space-y-3">
        {b.structureErrors.map((e) => <Alert key={e}>{e}</Alert>)}
        {b.notices.map((n) => <Alert key={n} kind="warning">{n}</Alert>)}
        {summary.otherCommittedBatchId && b.status === "in_review" && (
          <Alert kind="warning">
            Another file for {formatPeriod(b.period)} has already been committed (
            <Link className="underline" href={`/imports/${summary.otherCommittedBatchId}`}>import #{summary.otherCommittedBatchId}</Link>
            ). Members posted there are flagged as already posted.
          </Alert>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="In file" count={b.parsedCount} kobo={b.parsedTotalKobo} />
        {b.status === "committed" ? (
          <Stat label="Posted" count={counts.posted} kobo={totals.posted} tone="green" />
        ) : (
          <Stat label="Ready to post" count={counts.ok + counts.warning} kobo={totals.ok + totals.warning} tone="green" />
        )}
        <Stat label="Warnings" count={counts.warning} kobo={totals.warning} tone="amber" />
        <Stat label="Held back" count={counts.error} kobo={totals.error} tone="red" />
        <Stat label="Skipped" count={counts.skipped} kobo={totals.skipped} />
      </div>
      {b.controlTotalKobo !== null && (
        <p className={`mt-2 text-sm ${controlOk ? "text-emerald-700" : "text-red-700"}`}>
          {controlOk ? "✓" : "✗"} File&apos;s Grand Total: {b.controlCount ?? "?"} rows, {formatKobo(b.controlTotalKobo)}. Read from file: {b.parsedCount} rows, {formatKobo(b.parsedTotalKobo)}.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-1">
          <h2 className="mb-3 font-semibold">Exceptions by type</h2>
          {summary.errorsByCode.length ? (
            <ul className="space-y-2 text-sm">
              {summary.errorsByCode.map((e) => (
                <li key={e.code} className="flex justify-between gap-3">
                  <span>{describeCode(e.code)}</span>
                  <span className="whitespace-nowrap text-slate-600">{e.count} · {formatKobo(e.totalKobo)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No rows are held back.</p>
          )}
        </section>

        <section className="card lg:col-span-2">
          {b.status === "in_review" && canCommit && (
            <>
              <h2 className="mb-3 font-semibold">Commit</h2>
              <CommitPanel
                batchId={id}
                count={summary.toPost.count}
                totalKobo={summary.toPost.totalKobo}
                heldCount={counts.error}
                heldKobo={totals.error}
                blocked={b.structureErrors.length > 0}
              />
            </>
          )}
          {b.status === "in_review" && !canCommit && (
            <p className="text-sm text-slate-600">Review is complete when the exceptions are resolved. Someone with commit permission will post it.</p>
          )}
          {b.status === "committed" && (
            <p className="text-sm text-slate-700">
              {b.postedCount} rows ({formatKobo(b.postedTotalKobo)}) are on members&apos; savings for {formatPeriod(b.period)}.
              {counts.error > 0 && " Held-back rows can still be fixed and posted individually."}
              {counts.ok + counts.warning > 0 && (
                <strong className="mt-2 block text-amber-800">
                  {counts.ok + counts.warning} fixed row{counts.ok + counts.warning === 1 ? " is" : "s are"} ready to post — see Exceptions.
                </strong>
              )}
            </p>
          )}
          {b.status === "cancelled" && <p className="text-sm text-slate-600">This import was cancelled. Nothing from it was posted.</p>}
          {b.status === "in_review" && <div className="mt-4 border-t border-slate-100 pt-3"><CancelForm batchId={id} /></div>}
        </section>
      </div>

      <nav className="mt-8 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`?show=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {t.label} <span className="text-slate-400">{tabCount[t.key]}</span>
          </Link>
        ))}
      </nav>
      <div className="card overflow-x-auto rounded-t-none p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Employment no.</th>
              <th>Verification no.</th>
              <th className="text-right">Amount</th>
              <th>Member</th>
              <th>Outcome</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row: r, memberNo, memberName, suggested }) => {
              const changedEmp = r.employmentNo !== r.employmentNoRaw;
              return (
                <tr key={r.id} className="align-top">
                  <td className="text-slate-500">{r.rowNumber}</td>
                  <td className="font-mono text-xs whitespace-nowrap">
                    {changedEmp && <span className="block text-slate-400 line-through">{r.employmentNoRaw ?? "(blank)"}</span>}
                    {r.employmentNo ?? <span className="text-slate-400">(blank)</span>}
                  </td>
                  <td className="font-mono text-xs">{r.verificationNoRaw}</td>
                  <td className="text-right whitespace-nowrap">
                    {r.amountKobo !== null ? formatKobo(r.amountKobo) : <span className="text-red-700">{r.amountRaw ?? "(blank)"}</span>}
                  </td>
                  <td>
                    {r.memberId ? (
                      <Link href={`/members/${r.memberId}`} className="hover:underline">
                        <span className="font-mono text-xs text-brand-700">{memberNo}</span> {memberName}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="max-w-72"><RowOutcome row={r} /></td>
                  {canEdit && (
                    <td>
                      {!r.postedAt && (
                        <RowActions
                          batchId={id}
                          rowId={r.id}
                          employmentNo={r.employmentNo ?? ""}
                          amountNaira={r.amountKobo !== null ? String(r.amountKobo / 100) : r.amountRaw ?? ""}
                          skipped={r.resolution === "skipped"}
                          isError={r.status === "error"}
                          canPostLate={b.status === "committed" && canCommit}
                          suggestedEmploymentNo={suggested?.employeeNo ?? null}
                        />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500">Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
