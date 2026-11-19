import { redirect } from "next/navigation";
import { STAFF_PERMISSIONS } from "@/lib/permissions";
import { requireUser } from "@/server/auth/session";

export default async function Home() {
  const user = await requireUser();
  if (STAFF_PERMISSIONS.some((p) => user.permissions.has(p))) redirect("/members");
  if (user.memberId) redirect("/me");
  redirect("/forbidden");
}
