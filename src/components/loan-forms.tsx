"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui";
import { formatKobo } from "@/lib/format";
import { computeLoanTerms, isValidRatePercent } from "@/lib/loan-terms";
import { parseAmountToKobo } from "@/lib/money";
import type { LoanFormState } from "@/app/loan-actions";

type Action = (prev: LoanFormState, form: FormData) => Promise<LoanFormState>;

function Messages({ s }: { s: LoanFormState }) {
  return (
    <>
      {s.error && <Alert>{s.error}</Alert>}
      {s.success && <Alert kind="success">{s.success}</Alert>}
    </>
  );
}

export type SchemeOption = { id: number; name: string; type: string; maxPerMemberKobo: number | null; defaultTenureMonths: number; description: string | null };

export function ApplyForm({
  action,
  schemes,
  member,
  defaultSchemeId,
}: {
  action: Action;
  schemes: SchemeOption[];
  /** Staff only: the member being applied for. */
  member?: { id: number; label: string } | null;
  defaultSchemeId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [schemeId, setSchemeId] = useState(defaultSchemeId ?? "general");
  const scheme = schemes.find((s) => String(s.id) === schemeId);
  return (
    <form action={formAction} className="space-y-4">
      <Messages s={state} />
      {member !== undefined && (
        <div>
          <label className="label" htmlFor="memberNo">Member</label>
          {member ? (
            <>
              <input type="hidden" name="memberId" value={member.id} />
              <p className="text-sm font-medium">{member.label}</p>
            </>
          ) : (
            <p className="text-sm text-red-700">Open this form from the member&apos;s page, or search for them under Members.</p>
          )}
        </div>
      )}
      <div>
        <label className="label" htmlFor="schemeId">Loan</label>
        <select id="schemeId" name="schemeId" className="input" value={schemeId} onChange={(e) => setSchemeId(e.target.value)}>
          <option value="general">General loan request</option>
          {schemes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {scheme?.description && <p className="mt-1 text-sm text-slate-600">{scheme.description}</p>}
        {scheme?.maxPerMemberKobo && <p className="mt-1 text-xs text-slate-500">Up to {formatKobo(scheme.maxPerMemberKobo)} per member.</p>}
      </div>
      {schemeId === "general" && (
        <fieldset>
          <legend className="label">Type of loan</legend>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="loanType" value="regular" defaultChecked /> Regular (cash)</label>
            <label className="flex items-center gap-2"><input type="radio" name="loanType" value="commodity" /> Commodity (goods)</label>
          </div>
        </fieldset>
      )}
      <div>
        <label className="label" htmlFor="amount">Amount (₦)</label>
        <input id="amount" name="amount" inputMode="decimal" placeholder="e.g. 200,000" className="input" required />
        {state.fieldErrors?.amount && <p className="mt-1 text-sm text-red-600">{state.fieldErrors.amount}</p>}
      </div>
      <div>
        <label className="label" htmlFor="purpose">What is it for?</label>
        <textarea id="purpose" name="purpose" rows={3} className="input" placeholder="e.g. School fees for two children" required />
      </div>
      <div>
        <label className="label" htmlFor="tenure">Preferred repayment period (months, optional)</label>
        <input id="tenure" name="tenure" type="number" min={1} max={120} inputMode="numeric" defaultValue={scheme?.defaultTenureMonths} key={schemeId} className="input max-w-32" />
      </div>
      <button className="btn-primary w-full sm:w-auto" disabled={pending || member === null}>
        {pending ? "Sending…" : "Submit application"}
      </button>
      <p className="text-xs text-slate-500">The loan office will review it and send you an offer. Nothing is final until you accept.</p>
    </form>
  );
}

export function OfferForm({
  action,
  defaults,
}: {
  action: Action;
  defaults: { amountNaira: string; ratePercent: string; tenureMonths: number; firstRepaymentPeriod: string };
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [v, setV] = useState(defaults);
  const amount = parseAmountToKobo(v.amountNaira);
  const preview =
    amount.ok && amount.kobo > 0 && isValidRatePercent(v.ratePercent) && v.tenureMonths >= 1
      ? computeLoanTerms(amount.kobo, v.ratePercent, v.tenureMonths)
      : null;
  return (
    <form action={formAction} className="space-y-3" key={state.at ?? 0}>
      <Messages s={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="o-amount">Amount approved (₦)</label>
          <input id="o-amount" name="amount" className="input" value={v.amountNaira} onChange={(e) => setV({ ...v, amountNaira: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="o-rate">Interest (% flat)</label>
          <input id="o-rate" name="ratePercent" className="input" value={v.ratePercent} onChange={(e) => setV({ ...v, ratePercent: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="o-tenure">Repayment months</label>
          <input id="o-tenure" name="tenureMonths" type="number" min={1} max={120} className="input" value={v.tenureMonths} onChange={(e) => setV({ ...v, tenureMonths: Number(e.target.value) })} required />
        </div>
        <div>
          <label className="label" htmlFor="o-first">First repayment month</label>
          <input id="o-first" name="firstRepaymentPeriod" type="month" className="input" value={v.firstRepaymentPeriod} onChange={(e) => setV({ ...v, firstRepaymentPeriod: e.target.value })} required />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="o-cond">Conditions / note to member (optional)</label>
        <input id="o-cond" name="conditions" className="input" placeholder="e.g. Guarantor form required before payment" />
      </div>
      <div>
        <label className="label" htmlFor="o-valid">Offer valid for (days)</label>
        <input id="o-valid" name="validDays" type="number" min={1} max={90} defaultValue={14} className="input max-w-24" />
      </div>
      {preview && (
        <p className="rounded-md bg-slate-50 p-3 text-sm">
          Interest {formatKobo(preview.interestKobo)} · total to repay <strong>{formatKobo(preview.totalKobo)}</strong> ·{" "}
          <strong>{formatKobo(preview.instalmentKobo)}</strong> a month for {v.tenureMonths} months
          {preview.lastInstalmentKobo !== preview.instalmentKobo && ` (last month ${formatKobo(preview.lastInstalmentKobo)})`}
        </p>
      )}
      <button className="btn-primary" disabled={pending}>{pending ? "Sending…" : "Send offer"}</button>
    </form>
  );
}

/** Accept / decline / ask for an adjustment. Used by the member, or by staff on their behalf. */
export function RespondForm({ action, onBehalfOf }: { action: Action; onBehalfOf?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [mode, setMode] = useState<"accepted" | "declined" | "adjustment_requested">("accepted");
  if (state.success) return <Alert kind="success">{state.success}</Alert>;
  return (
    <form action={formAction} className="space-y-3">
      <Messages s={state} />
      {onBehalfOf && <p className="text-sm text-amber-800">You are recording {onBehalfOf}&apos;s answer on their behalf.</p>}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["accepted", "Accept"],
            ["adjustment_requested", "Ask to adjust"],
            ["declined", "Decline"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={`cursor-pointer rounded-md border px-2 py-2 text-center text-sm font-medium ${mode === value ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700"}`}
          >
            <input type="radio" name="response" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
            {label}
          </label>
        ))}
      </div>
      {mode !== "accepted" && (
        <div>
          <label className="label" htmlFor="r-note">{mode === "adjustment_requested" ? "What would you like changed?" : "Reason (optional)"}</label>
          <textarea
            id="r-note"
            name="note"
            rows={2}
            className="input"
            placeholder={mode === "adjustment_requested" ? "e.g. ₦150,000 over 12 months" : ""}
            required={mode === "adjustment_requested"}
          />
        </div>
      )}
      {mode === "accepted" && <input type="hidden" name="note" value="" />}
      <button className={mode === "declined" ? "btn-danger w-full sm:w-auto" : "btn-primary w-full sm:w-auto"} disabled={pending}>
        {pending ? "Sending…" : mode === "accepted" ? "Accept this offer" : mode === "declined" ? "Decline offer" : "Send request"}
      </button>
    </form>
  );
}

export function ReasonForm({ action, label, button, danger }: { action: Action; label: string; button: string; danger?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.success) return <Alert kind="success">{state.success}</Alert>;
  return (
    <details>
      <summary className="cursor-pointer text-sm text-slate-600 hover:underline">{button}</summary>
      <form action={formAction} className="mt-2 space-y-2">
        <Messages s={state} />
        <input name="reason" placeholder={label} className="input" required={danger} />
        <button className={danger ? "btn-danger" : "btn-secondary"} disabled={pending}>{button}</button>
      </form>
    </details>
  );
}

export function SchemeForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2" key={state.at ?? 0}>
      <div className="sm:col-span-2"><Messages s={state} /></div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="s-name">Name</label>
        <input id="s-name" name="name" className="input" placeholder="e.g. December special loan" required />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="s-desc">Description for members</label>
        <textarea id="s-desc" name="description" rows={2} className="input" placeholder="Who it's for, conditions, how it's repaid" />
      </div>
      <div>
        <label className="label" htmlFor="s-type">Type</label>
        <select id="s-type" name="type" className="input" defaultValue="special">
          <option value="special">Special</option>
          <option value="regular">Regular (cash)</option>
          <option value="commodity">Commodity (goods)</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="s-rate">Interest (% flat)</label>
        <input id="s-rate" name="ratePercent" className="input" defaultValue="10" required />
      </div>
      <div>
        <label className="label" htmlFor="s-pool">Money available (₦, optional)</label>
        <input id="s-pool" name="pool" className="input" placeholder="e.g. 20,000,000" />
      </div>
      <div>
        <label className="label" htmlFor="s-max">Maximum per member (₦, optional)</label>
        <input id="s-max" name="maxPerMember" className="input" placeholder="e.g. 300,000" />
      </div>
      <div>
        <label className="label" htmlFor="s-tenure">Repayment months</label>
        <input id="s-tenure" name="tenureMonths" type="number" min={1} max={120} defaultValue={10} className="input" required />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="s-open">Opens</label>
          <input id="s-open" name="opensOn" type="date" defaultValue={today} className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="s-close">Closes (optional)</label>
          <input id="s-close" name="closesOn" type="date" className="input" />
        </div>
      </div>
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Open scheme"}</button>
      </div>
    </form>
  );
}
