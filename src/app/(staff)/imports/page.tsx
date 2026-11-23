import Link from "next/link";
import { BatchStatusBadge } from "@/components/import-ui";
import { PageHeader } from "@/components/ui";
import { formatDateTime, formatKobo } from "@/lib/format";
import { formatPeriod } from "@/lib/period";
import { requirePermission } from "@/server/auth/session";
import { listBatches } from "@/server/imports/service";

export const metadata = { title: "Deduction imports" };

export default async function ImportsPage() {
  await requirePermission("import.upload");
  const batches = await listBatches();
  return (
    <>
      <PageHeader
        title="Deduction imports"
        subtitle="Monthly payroll files from the bank. Nothing is posted to savings until a file is reviewed and committed."
        actions={<Link href="/imports/new" className="btn-primary">Upload bank file</Link>}
      />
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Month</th>
              <th>File</th>
              <th className="text-right">Rows</th>
              <th className="text-right">File total</th>
              <th className="text-right">Posted</th>
              <th>Open exceptions</th>
              <th>Status</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {batches.map(({ batch: b, uploadedByName, rows, errors }) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td><Link href={`/imports/${b.id}`} className="text-brand-700 hover:underline">#{b.id}</Link></td>
                <td className="whitespace-nowrap">{formatPeriod(b.period)}</td>
                <td className="max-w-48 truncate" title={b.fileName}>{b.fileName}</td>
                <td className="text-right">{rows}</td>
                <td className="text-right whitespace-nowrap">{formatKobo(b.parsedTotalKobo)}</td>
                <td className="text-right whitespace-nowrap">{b.status === "committed" ? formatKobo(b.postedTotalKobo) : "—"}</td>
                <td>{b.status === "cancelled" ? "—" : errors ? <span className="font-medium text-red-700">{errors}</span> : "None"}</td>
                <td><BatchStatusBadge status={b.status} /></td>
                <td className="whitespace-nowrap text-slate-500">{formatDateTime(b.createdAt)} · {uploadedByName}</td>
              </tr>
            ))}
            {!batches.length && (
              <tr><td colSpan={9} className="py-10 text-center text-slate-500">No files uploaded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
