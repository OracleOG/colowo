"use server";

import { redirect } from "next/navigation";
import { DomainError } from "@/server/errors";
import { attemptLogin, changePassword } from "@/server/auth/users";
import { actorFor, clientIp, endSession, getCurrentUser, startSession } from "@/server/auth/session";

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const login = String(form.get("login") ?? "");
  const password = String(form.get("password") ?? "");
  if (!login || !password) return { error: "Enter your login and password." };

  const result = await attemptLogin(login, password, await clientIp());
  if (!result.ok) {
    return {
      error:
        result.reason === "locked"
          ? "Too many failed attempts. Try again in 15 minutes."
          : "Incorrect login or password.",
    };
  }
  await startSession(result.userId);
  redirect(result.mustChangePassword ? "/account/password" : "/");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const current = String(form.get("current") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) {
    return { fieldErrors: { confirm: ["Passwords do not match."] } };
  }
  try {
    await changePassword(await actorFor(user), user.id, current, password);
  } catch (e) {
    if (e instanceof DomainError) return { fieldErrors: { [e.field ?? "password"]: [e.message] } };
    throw e;
  }
  redirect("/");
}
