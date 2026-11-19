import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { AuditRow } from "@/server/audit-queries";

function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => !["createdAt", "updatedAt", "id"].includes(k),
  );
  if (!keys.length) return <span className="text-slate-400">—</span>;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "∅" : String(v));
  return (
    <ul className="space-y-0.5 text-xs">
      {keys.map((k) => (
        <li key={k}>
          <span className="text-slate-500">{k}:</span>{" "}
          {k in b && <><span className="text-red-700 line-through">{show(b[k])}</span> → </>}
          <span className="text-emerald-700">{show(a[k])}</span>
        </li>
      ))}
    </ul>
  );
}

export function AuditTable({ rows, showEntity = true }: { rows: AuditRow[]; showEntity?: boolean }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No activity recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            {showEntity && <th>Record</th>}
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap">{formatDateTime(r.at)}</td>
              <td>{r.userName ?? <span className="text-slate-400">System</span>}</td>
              <td className="font-mono text-xs">{r.action}</td>
              {showEntity && (
                <td className="text-xs">
                  {r.entityType === "member" ? (
                    <Link className="text-brand-700 hover:underline" href={`/members/${r.entityId}`}>member #{r.entityId}</Link>
                  ) : (
                    `${r.entityType} #${r.entityId}`
                  )}
                </td>
              )}
              <td><Changes before={r.before} after={r.after} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
