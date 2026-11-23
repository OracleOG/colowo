"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui";
import { formatKobo } from "@/lib/format";
import {
  cancelAction,
  commitAction,
  correctRowAction,
  postLateRowAction,
  skipRowAction,
  type ActionState,
} from "../actions";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-xs text-red-700">{s.error}</p>;
  if (s.success) return <p className="text-xs text-emerald-700">{s.success}</p>;
  return null;
}

export function RowActions(props: {
  batchId: number;
  rowId: number;
  employmentNo: string;
  amountNaira: string;
  skipped: boolean;
  isError: boolean;
  canPostLate: boolean;
  suggestedEmploymentNo: string | null;
}) {
  const { batchId, rowId } = props;
  const [cState, correct, cPending] = useActionState(correctRowAction.bind(null, batchId, rowId), {});
  const [sState, skip, sPending] = useActionState(skipRowAction.bind(null, batchId, rowId, !props.skipped), {});
  const [pState, postLate, pPending] = useActionState(postLateRowAction.bind(null, batchId, rowId), {});

  if (props.skipped) {
    return (
      <form action={skip} className="space-y-1">
        <button className="text-xs text-brand-700 hover:underline" disabled={sPending}>Restore row</button>
        <Msg s={sState} />
      </form>
    );
  }
  return (
    <div className="space-y-2">
      {props.canPostLate && !props.isError && (
        <form action={postLate}>
          <button className="btn-primary px-2 py-1 text-xs" disabled={pPending}>Post to savings</button>
          <Msg s={pState} />
        </form>
      )}
      <details className="group">
        <summary className="cursor-pointer text-xs text-brand-700 hover:underline">Fix or skip</summary>
        <div className="mt-2 w-64 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <form action={correct} className="space-y-2">
            <label className="block text-xs text-slate-600">
              Employment no.
              <input name="employmentNo" defaultValue={props.suggestedEmploymentNo ?? props.employmentNo} className="input mt-0.5 py-1 font-mono text-xs" />
            </label>
            {props.suggestedEmploymentNo && (
              <p className="text-xs text-slate-500">Pre-filled from the verification-number match. Check before saving.</p>
            )}
            <label className="block text-xs text-slate-600">
              Amount (₦)
              <input name="amount" defaultValue={props.amountNaira} className="input mt-0.5 py-1 text-xs" />
            </label>
            <label className="block text-xs text-slate-600">
              Note
              <input name="note" placeholder="Why it was changed" className="input mt-0.5 py-1 text-xs" />
            </label>
            <button className="btn-secondary px-2 py-1 text-xs" disabled={cPending}>Save &amp; re-check</button>
            <Msg s={cState} />
          </form>
          <form action={skip} className="space-y-2 border-t border-slate-200 pt-2">
            <input name="note" placeholder="Reason for skipping" className="input py-1 text-xs" required />
            <button className="btn-secondary px-2 py-1 text-xs" disabled={sPending}>Skip this row</button>
            <Msg s={sState} />
          </form>
        </div>
      </details>
    </div>
  );
}

export function CommitPanel(props: {
  batchId: number;
  count: number;
  totalKobo: number;
  heldCount: number;
  heldKobo: number;
  blocked: boolean;
}) {
  const [state, action, pending] = useActionState(commitAction.bind(null, props.batchId), {});
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      <p className="text-sm">
        Post <strong>{props.count}</strong> rows totalling <strong>{formatKobo(props.totalKobo)}</strong> to members&apos; savings for this month.
      </p>
      {props.heldCount > 0 && (
        <p className="text-sm text-slate-600">
          {props.heldCount} row{props.heldCount === 1 ? "" : "s"} ({formatKobo(props.heldKobo)}) will be held back. They stay on this report and can be fixed and posted later.
        </p>
      )}
      <input type="hidden" name="expectedCount" value={props.count} />
      <input type="hidden" name="expectedTotalKobo" value={props.totalKobo} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-0.5" disabled={props.blocked} />
        I have reviewed the exceptions and confirm these figures.
      </label>
      <button className="btn-primary" disabled={pending || props.blocked || props.count === 0}>
        {pending ? "Posting…" : "Commit to savings"}
      </button>
    </form>
  );
}

export function CancelForm({ batchId }: { batchId: number }) {
  const [state, action, pending] = useActionState(cancelAction.bind(null, batchId), {});
  return (
    <details>
      <summary className="cursor-pointer text-sm text-slate-600 hover:underline">Cancel this import</summary>
      <form action={action} className="mt-2 flex flex-wrap gap-2">
        <input name="reason" placeholder="Reason (e.g. wrong file)" className="input max-w-xs" required />
        <button className="btn-danger" disabled={pending}>Cancel import</button>
        <Msg s={state} />
      </form>
    </details>
  );
}
