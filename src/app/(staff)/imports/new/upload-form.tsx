"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui";
import { uploadAction, type ActionState } from "../actions";

export function UploadForm({ defaultPeriod }: { defaultPeriod: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <Alert>
          {state.error}{" "}
          {state.batchId && <Link className="underline" href={`/imports/${state.batchId}`}>Open batch #{state.batchId}</Link>}
        </Alert>
      )}
      <div>
        <label className="label" htmlFor="period">Deduction month</label>
        <input id="period" name="period" type="month" className="input max-w-xs" defaultValue={defaultPeriod} required />
        <p className="mt-1 text-xs text-slate-500">It must match the month printed in the file&apos;s title.</p>
      </div>
      <div>
        <label className="label" htmlFor="file">Bank file</label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          required
        />
      </div>
      <button className="btn-primary" disabled={pending}>{pending ? "Reading file…" : "Upload and check"}</button>
    </form>
  );
}
