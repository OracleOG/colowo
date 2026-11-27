import { redirect } from "next/navigation";
import { applyAction } from "@/app/loan-actions";
import { ApplyForm } from "@/components/loan-forms";
import { MemberShell } from "@/components/member-shell";
import { requirePermission } from "@/server/auth/session";
import { listSchemes } from "@/server/loans/applications";

export const metadata = { title: "Apply for a loan" };

export default async function MemberApplyPage({ searchParams }: { searchParams: Promise<{ scheme?: string }> }) {
  const user = await requirePermission("self.view");
  if (!user.memberId) redirect("/");
  const schemes = await listSchemes({ openOnly: true });
  return (
    <MemberShell back={{ href: "/me", label: "My account" }}>
      <h1 className="mb-4 text-xl font-semibold">Apply for a loan</h1>
      <div className="card">
        <ApplyForm action={applyAction.bind(null, false)} schemes={schemes} defaultSchemeId={(await searchParams).scheme} />
      </div>
    </MemberShell>
  );
}
