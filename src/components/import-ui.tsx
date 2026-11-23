import type { ImportBatch, ImportRow } from "@/db/schema";
import { describeCode } from "@/lib/import-codes";

export function BatchStatusBadge({ status }: { status: ImportBatch["status"] }) {
  const style = {
    in_review: "bg-amber-50 text-amber-800 ring-amber-600/20",
    committed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    cancelled: "bg-slate-100 text-slate-600 ring-slate-500/20",
  }[status];
  const label = { in_review: "In review", committed: "Committed", cancelled: "Cancelled" }[status];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}>{label}</span>;
}

export function RowOutcome({ row }: { row: ImportRow }) {
  if (row.postedAt) return <span className="text-emerald-700">Posted</span>;
  if (row.resolution === "skipped") return <span className="text-slate-500">Skipped{row.note ? ` — ${row.note}` : ""}</span>;
  if (row.status === "error") {
    return (
      <span className="text-red-700">
        <span className="font-medium">{describeCode(row.errorCode)}</span>
        {row.message && <span className="block text-xs text-red-600/80">{row.message}</span>}
      </span>
    );
  }
  return (
    <span className={row.status === "warning" ? "text-amber-800" : "text-slate-600"}>
      {row.status === "warning" ? row.warnings.map(describeCode).join("; ") : "Ready"}
      {row.resolution === "corrected" && <span className="block text-xs text-slate-500">Corrected{row.note ? ` — ${row.note}` : ""}</span>}
    </span>
  );
}
