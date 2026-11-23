"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorFor, requirePermission } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import {
  cancelBatch,
  commitBatch,
  correctRow,
  postHeldBackRow,
  setRowSkipped,
  uploadBatch,
} from "@/server/imports/service";

export type ActionState = { error?: string; success?: string; batchId?: number };

function fail(e: unknown): ActionState {
  if (e instanceof DomainError) {
    const d = e.details as { batchId?: number } | undefined;
    return { error: e.message, batchId: d?.batchId };
  }
  throw e;
}

export async function uploadAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("import.upload");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the bank file to upload." };
  let id: number;
  try {
    id = await uploadBatch(await actorFor(user), {
      period: String(form.get("period") ?? ""),
      fileName: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/imports");
  redirect(`/imports/${id}`);
}

export async function correctRowAction(batchId: number, rowId: number, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("import.upload");
  try {
    await correctRow(await actorFor(user), rowId, {
      employmentNo: String(form.get("employmentNo") ?? ""),
      amount: String(form.get("amount") ?? ""),
      note: String(form.get("note") ?? ""),
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/imports/${batchId}`);
  return { success: "Saved and re-checked." };
}

export async function skipRowAction(batchId: number, rowId: number, skip: boolean, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("import.upload");
  try {
    await setRowSkipped(await actorFor(user), rowId, skip, String(form.get("note") ?? ""));
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/imports/${batchId}`);
  return { success: skip ? "Row skipped." : "Row restored." };
}

export async function postLateRowAction(batchId: number, rowId: number, _: ActionState): Promise<ActionState> {
  const user = await requirePermission("import.commit");
  try {
    await postHeldBackRow(await actorFor(user), rowId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/imports/${batchId}`);
  return { success: "Posted to savings." };
}

export async function commitAction(batchId: number, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("import.commit");
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm the numbers." };
  try {
    await commitBatch(await actorFor(user), batchId, {
      count: Number(form.get("expectedCount")),
      totalKobo: Number(form.get("expectedTotalKobo")),
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/imports");
  return { success: "Committed. Contributions are now on members' savings." };
}

export async function cancelAction(batchId: number, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("import.upload");
  try {
    await cancelBatch(await actorFor(user), batchId, String(form.get("reason") ?? ""));
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/imports");
  return { success: "Import cancelled. Nothing was posted." };
}
