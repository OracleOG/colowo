"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "../actions";
import { Alert } from "@/components/ui";

export default function LoginPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-brand-700">Colowo</h1>
          <p className="mt-1 text-sm text-slate-500">Cooperative savings &amp; loans</p>
        </div>
        <form action={action} className="card space-y-4">
          {state.error && <Alert>{state.error}</Alert>}
          <div>
            <label className="label" htmlFor="login">
              Email or member number
            </label>
            <input id="login" name="login" className="input" autoComplete="username" required autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn-primary w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
