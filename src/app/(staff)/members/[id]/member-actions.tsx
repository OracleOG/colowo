"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui";
import type { Member } from "@/db/schema";
import type { SimpleState } from "../actions";

type Action = (prev: SimpleState, form: FormData) => Promise<SimpleState>;

export function StatusForm({ action, status, today }: { action: Action; status: Member["status"]; today: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const options = (status === "active" ? ["suspended", "exited"] : ["active", "exited"]) as Member["status"][];
  const [next, setNext] = useState<Member["status"]>(options[0]);

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <div>
        <label className="label" htmlFor="status">Change status to</label>
        <select id="status" name="status" className="input" value={next} onChange={(e) => setNext(e.target.value as Member["status"])}>
          {options.map((o) => (
            <option key={o} value={o}>{o === "active" ? "Active (reinstate)" : o === "exited" ? "Exited (final)" : "Suspended"}</option>
          ))}
        </select>
      </div>
      {next === "exited" && (
        <div>
          <label className="label" htmlFor="dateExited">Exit date</label>
          <input id="dateExited" name="dateExited" type="date" max={today} className="input" required />
          <p className="mt-1 text-xs text-slate-500">
            Exited members keep all history but can no longer receive deductions or loans. This cannot be undone.
          </p>
        </div>
      )}
      <div>
        <label className="label" htmlFor="reason">Reason</label>
        <input id="reason" name="reason" className="input" required />
      </div>
      <button className={next === "exited" ? "btn-danger" : "btn-secondary"} disabled={pending}>
        {pending ? "Saving…" : "Update status"}
      </button>
    </form>
  );
}

export function LoginForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.success) return <Alert kind="success">{state.success}</Alert>;
  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      <div>
        <label className="label" htmlFor="tempPassword">Temporary password</label>
        <input id="tempPassword" name="tempPassword" className="input" minLength={8} required autoComplete="off" />
        <p className="mt-1 text-xs text-slate-500">The member must change it the first time they sign in.</p>
      </div>
      <button className="btn-secondary" disabled={pending}>{pending ? "Creating…" : "Create member login"}</button>
    </form>
  );
}

export function ManualEntryForm({
  action,
  canAdjust,
  defaultPeriod,
  today,
}: {
  action: Action;
  canAdjust: boolean;
  defaultPeriod: string;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2" key={state.at ?? 0}>
      {state.error && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state.success && <div className="sm:col-span-2"><Alert kind="success">{state.success}</Alert></div>}
      <div>
        <label className="label" htmlFor="type">Type</label>
        <select id="type" name="type" className="input">
          <option value="contribution">Contribution (cash / transfer)</option>
          <option value="withdrawal">Withdrawal</option>
          {canAdjust && <option value="adjustment_credit">Adjustment — add</option>}
          {canAdjust && <option value="adjustment_debit">Adjustment — deduct</option>}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="amount">Amount (₦)</label>
        <input id="amount" name="amount" inputMode="decimal" className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="period">Month it belongs to</label>
        <input id="period" name="period" type="month" defaultValue={defaultPeriod} className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="txnDate">Date received / paid</label>
        <input id="txnDate" name="txnDate" type="date" defaultValue={today} max={today} className="input" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="narration">Description</label>
        <input id="narration" name="narration" placeholder="e.g. Transfer ref 123456, approved by Exco" className="input" required />
      </div>
      <div className="sm:col-span-2">
        <button className="btn-secondary" disabled={pending}>{pending ? "Saving…" : "Record transaction"}</button>
      </div>
    </form>
  );
}

export function ReverseForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.success) return <span className="text-xs text-emerald-700">{state.success}</span>;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-slate-500 hover:underline">Reverse</summary>
      <form action={formAction} className="mt-1 flex w-56 flex-col gap-1">
        <input name="reason" placeholder="Reason" className="input py-1 text-xs" required />
        <button className="btn-danger px-2 py-1 text-xs" disabled={pending}>Reverse transaction</button>
        {state.error && <span className="text-xs text-red-700">{state.error}</span>}
      </form>
    </details>
  );
}
