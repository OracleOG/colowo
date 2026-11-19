"use client";

import { useActionState } from "react";
import { changePasswordAction, type FormState } from "../../actions";
import { FieldError } from "@/components/ui";

export default function ChangePasswordPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={action} className="card w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Set your password</h1>
          <p className="mt-1 text-sm text-slate-500">Choose a new password of at least 8 characters.</p>
        </div>
        <div>
          <label className="label" htmlFor="current">Current (temporary) password</label>
          <input id="current" name="current" type="password" className="input" autoComplete="current-password" required />
          <FieldError errors={fe.current} />
        </div>
        <div>
          <label className="label" htmlFor="password">New password</label>
          <input id="password" name="password" type="password" className="input" autoComplete="new-password" minLength={8} required />
          <FieldError errors={fe.password} />
        </div>
        <div>
          <label className="label" htmlFor="confirm">Confirm new password</label>
          <input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" required />
          <FieldError errors={fe.confirm} />
        </div>
        <button className="btn-primary w-full" disabled={pending}>
          {pending ? "Saving…" : "Save password"}
        </button>
      </form>
    </main>
  );
}
