"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, FieldError, StatusBadge } from "@/components/ui";
import type { MemberInput } from "@/server/members";
import type { MemberFormState } from "./actions";

type Props = {
  action: (prev: MemberFormState, form: FormData) => Promise<MemberFormState>;
  initial: MemberInput;
  submitLabel: string;
  readOnly?: boolean;
};

export function MemberForm({ action, initial, submitLabel, readOnly }: Props) {
  const [state, formAction, pending] = useActionState(action, { attempt: 0 });
  const v = state.values ?? initial;
  const fe = state.fieldErrors ?? {};
  const field = (name: keyof MemberInput, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        className="input"
        defaultValue={(v[name] as string | null | undefined) ?? ""}
        disabled={readOnly}
        {...props}
      />
      <FieldError errors={fe[name]} />
    </div>
  );

  return (
    <form key={state.attempt} action={formAction} className="space-y-4">
      {state.success && <Alert kind="success">{state.success}</Alert>}
      {state.error && !state.duplicates && <Alert>{state.error}</Alert>}
      {state.duplicates && (
        <Alert kind="warning">
          <p className="font-medium">{state.error}</p>
          <ul className="mt-2 space-y-1">
            {state.duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/members/${d.id}`} className="underline" target="_blank">
                  {d.memberNo} — {d.fullName}
                </Link>{" "}
                <StatusBadge status={d.status} />
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2">
            <input type="checkbox" name="allowDuplicate" /> This is a different person — save anyway
          </label>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{field("fullName", "Full name", { required: true })}</div>
        {field("employeeNo", "Employment number (bank file, e.g. EMP0013145)")}
        {field("verificationNo", "Verification number (bank file)")}
        {field("fileNo", "File number (old deduction record)")}
        {field("dateJoined", "Date joined", { type: "date", required: true })}
        {field("phone", "Phone", { type: "tel", placeholder: "0803 123 4567" })}
        {field("email", "Email", { type: "email" })}
        {field("legacyRef", "Old workbook reference (optional)", { placeholder: "e.g. sheet name" })}
        <div className="sm:col-span-2">
          <label className="label" htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={3} className="input" defaultValue={v.notes ?? ""} disabled={readOnly} />
          <FieldError errors={fe.notes} />
        </div>
      </div>
      {!readOnly && (
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      )}
    </form>
  );
}
