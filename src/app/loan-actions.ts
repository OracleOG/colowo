"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAmountToKobo } from "@/lib/money";
import { loanActorFor, requireUser } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import {
  applyForLoan,
  cancelApplication,
  createScheme,
  makeOffer,
  rejectApplication,
  respondToOffer,
  setSchemeStatus,
} from "@/server/loans/applications";

export type LoanFormState = { error?: string; success?: string; fieldErrors?: Record<string, string>; at?: number };

function fail(e: unknown): LoanFormState {
  if (e instanceof DomainError) return { error: e.message, fieldErrors: e.field ? { [e.field]: e.message } : undefined };
  throw e;
}
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const int = (f: FormData, k: string) => (str(f, k) ? Number(str(f, k)) : null);
function kobo(f: FormData, k: string): number | null {
  const v = str(f, k);
  if (!v) return null;
  const p = parseAmountToKobo(v);
  if (!p.ok) throw new DomainError("VALIDATION", "Enter a valid amount.", k);
  return p.kobo;
}
function refresh(id?: number) {
  revalidatePath("/loans");
  revalidatePath("/me");
  if (id) {
    revalidatePath(`/loans/${id}`);
    revalidatePath(`/me/loans/${id}`);
  }
}

/** Apply — by the member themselves (memberId from session) or by staff for a member. */
export async function applyAction(staff: boolean, _: LoanFormState, form: FormData): Promise<LoanFormState> {
  const user = await requireUser();
  let id: number;
  try {
    let memberId = user.memberId;
    if (staff) {
      memberId = int(form, "memberId");
      if (!memberId) throw new DomainError("VALIDATION", "Choose the member.", "memberId");
    }
    if (!memberId) throw new DomainError("FORBIDDEN", "Your login isn't linked to a member record.");
    const schemeId = str(form, "schemeId");
    const app = await applyForLoan(await loanActorFor(user), {
      memberId,
      schemeId: schemeId && schemeId !== "general" ? Number(schemeId) : null,
      loanType: (str(form, "loanType") || "regular") as "regular" | "commodity",
      requestedKobo: kobo(form, "amount") ?? 0,
      purpose: str(form, "purpose"),
      preferredTenureMonths: int(form, "tenure"),
    });
    id = app.id;
  } catch (e) {
    return fail(e);
  }
  refresh(id);
  redirect(staff ? `/loans/${id}` : `/me/loans/${id}?applied=1`);
}

export async function offerAction(applicationId: number, _: LoanFormState, form: FormData): Promise<LoanFormState> {
  const user = await requireUser();
  try {
    await makeOffer(await loanActorFor(user), applicationId, {
      amountKobo: kobo(form, "amount") ?? 0,
      ratePercent: str(form, "ratePercent"),
      tenureMonths: int(form, "tenureMonths") ?? 0,
      firstRepaymentPeriod: str(form, "firstRepaymentPeriod"),
      conditions: str(form, "conditions"),
      validDays: int(form, "validDays") ?? undefined,
    });
  } catch (e) {
    return fail(e);
  }
  refresh(applicationId);
  return { success: "Offer sent. The member can now accept, decline or ask for an adjustment.", at: Date.now() };
}

export async function respondAction(applicationId: number, _: LoanFormState, form: FormData): Promise<LoanFormState> {
  const user = await requireUser();
  const response = str(form, "response") as "accepted" | "declined" | "adjustment_requested";
  try {
    if (!["accepted", "declined", "adjustment_requested"].includes(response)) throw new DomainError("VALIDATION", "Choose a response.");
    await respondToOffer(await loanActorFor(user), applicationId, { response, note: str(form, "note") } as never);
  } catch (e) {
    return fail(e);
  }
  refresh(applicationId);
  return {
    success:
      response === "accepted"
        ? "Accepted. The loan office will arrange payment."
        : response === "declined"
          ? "Offer declined."
          : "Your request has been sent to the loan office.",
    at: Date.now(),
  };
}

export async function rejectAction(applicationId: number, _: LoanFormState, form: FormData): Promise<LoanFormState> {
  const user = await requireUser();
  try {
    await rejectApplication(await loanActorFor(user), applicationId, str(form, "reason"));
  } catch (e) {
    return fail(e);
  }
  refresh(applicationId);
  return { success: "Application rejected.", at: Date.now() };
}

export async function cancelLoanAction(applicationId: number, _: LoanFormState, form: FormData): Promise<LoanFormState> {
  const user = await requireUser();
  try {
    await cancelApplication(await loanActorFor(user), applicationId, str(form, "reason"));
  } catch (e) {
    return fail(e);
  }
  refresh(applicationId);
  return { success: "Application cancelled.", at: Date.now() };
}

export async function createSchemeAction(_: LoanFormState, form: FormData): Promise<LoanFormState> {
  const user = await requireUser();
  try {
    await createScheme(await loanActorFor(user), {
      name: str(form, "name"),
      type: (str(form, "type") || "special") as "regular" | "commodity" | "special",
      description: str(form, "description"),
      poolKobo: kobo(form, "pool"),
      maxPerMemberKobo: kobo(form, "maxPerMember"),
      defaultRatePercent: str(form, "ratePercent"),
      defaultTenureMonths: int(form, "tenureMonths") ?? 0,
      opensOn: str(form, "opensOn"),
      closesOn: str(form, "closesOn") || null,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/loans/schemes");
  refresh();
  return { success: "Scheme created. Members can now see it and apply.", at: Date.now() };
}

export async function schemeStatusAction(id: number, status: "open" | "closed") {
  const user = await requireUser();
  await setSchemeStatus(await loanActorFor(user), id, status);
  revalidatePath("/loans/schemes");
  refresh();
}
