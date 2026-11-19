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
