"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Member } from "@/db/schema";
import { actorFor, requirePermission } from "@/server/auth/session";
import { createMemberLogin } from "@/server/auth/users";
import { DomainError } from "@/server/errors";
import { parseAmountToKobo } from "@/lib/money";
import { recordManualEntry, reverseSavingsTransaction } from "@/server/savings/ledger";
import {
  changeMemberStatus,
  createMember,
  updateMember,
  type DuplicateCandidate,
  type MemberInput,
} from "@/server/members";

export type MemberFormState = {
  attempt: number;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  duplicates?: DuplicateCandidate[];
  values?: MemberInput;
  success?: string;
};

function readMemberForm(form: FormData): MemberInput {
  const v = (k: string) => String(form.get(k) ?? "");
  return {
    fullName: v("fullName"),
    employeeNo: v("employeeNo"),
    verificationNo: v("verificationNo"),
    fileNo: v("fileNo"),
    phone: v("phone"),
    email: v("email"),
    dateJoined: v("dateJoined"),
    legacyRef: v("legacyRef"),
    notes: v("notes"),
  };
}

function toState(prev: MemberFormState, e: unknown, values?: MemberInput): MemberFormState {
  if (!(e instanceof DomainError)) throw e;
  const base = { attempt: prev.attempt + 1, values, error: e.message };
  if (e.code === "VALIDATION") {
    return { ...base, fieldErrors: (e.details as Record<string, string[]>) ?? (e.field ? { [e.field]: [e.message] } : {}) };
  }
  if (e.code === "POSSIBLE_DUPLICATE") return { ...base, duplicates: e.details as DuplicateCandidate[] };
  return { ...base, fieldErrors: e.field ? { [e.field]: [e.message] } : undefined };
}

export async function createMemberAction(prev: MemberFormState, form: FormData): Promise<MemberFormState> {
  const user = await requirePermission("member.manage");
  const values = readMemberForm(form);
  let id: number;
  try {
    const m = await createMember(await actorFor(user), values, { allowDuplicate: form.get("allowDuplicate") === "on" });
    id = m.id;
  } catch (e) {
    return toState(prev, e, values);
  }
  revalidatePath("/members");
  redirect(`/members/${id}?created=1`);
}

export async function updateMemberAction(id: number, prev: MemberFormState, form: FormData): Promise<MemberFormState> {
  const user = await requirePermission("member.manage");
  const values = readMemberForm(form);
  try {
    await updateMember(await actorFor(user), id, values, { allowDuplicate: form.get("allowDuplicate") === "on" });
  } catch (e) {
    return toState(prev, e, values);
  }
  revalidatePath(`/members/${id}`);
  return { attempt: prev.attempt + 1, success: "Changes saved." };
}

export type SimpleState = { error?: string; success?: string; /** changes on each success, to reset forms */ at?: number };

export async function changeStatusAction(id: number, _: SimpleState, form: FormData): Promise<SimpleState> {
  const user = await requirePermission("member.manage");
  try {
    await changeMemberStatus(await actorFor(user), id, {
      status: String(form.get("status")) as Member["status"],
      reason: String(form.get("reason") ?? ""),
      dateExited: String(form.get("dateExited") ?? "") || undefined,
    });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/members/${id}`);
  return { success: "Status updated." };
}

export async function createLoginAction(id: number, _: SimpleState, form: FormData): Promise<SimpleState> {
  const user = await requirePermission("user.manage");
  try {
    await createMemberLogin(await actorFor(user), id, String(form.get("tempPassword") ?? ""));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/members/${id}`);
  return { success: "Login created. Give the member their member number and temporary password." };
}

export async function manualEntryAction(memberId: number, _: SimpleState, form: FormData): Promise<SimpleState> {
  const type = String(form.get("type")) as "contribution" | "withdrawal" | "adjustment_credit" | "adjustment_debit";
  const isAdjustment = type.startsWith("adjustment");
  const user = await requirePermission(isAdjustment ? "ledger.adjust" : "ledger.manual_entry");
  const amount = parseAmountToKobo(String(form.get("amount") ?? ""));
  if (!amount.ok) return { error: "Enter a valid amount." };
  try {
    await recordManualEntry(await actorFor(user), {
      memberId,
      type: isAdjustment ? "adjustment" : (type as "contribution" | "withdrawal"),
      direction: type === "adjustment_debit" ? "debit" : "credit",
      amountKobo: amount.kobo,
      period: String(form.get("period") ?? ""),
      txnDate: String(form.get("txnDate") ?? "") || undefined,
      narration: String(form.get("narration") ?? ""),
    });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/members/${memberId}`);
  return { success: "Recorded.", at: Date.now() };
}

export async function reverseTxnAction(memberId: number, txnId: number, _: SimpleState, form: FormData): Promise<SimpleState> {
  const user = await requirePermission("ledger.adjust");
  try {
    await reverseSavingsTransaction(await actorFor(user), txnId, String(form.get("reason") ?? ""));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/members/${memberId}`);
  return { success: "Reversed." };
}
