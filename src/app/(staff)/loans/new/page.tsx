import Link from "next/link";
import { applyAction } from "@/app/loan-actions";
import { ApplyForm } from "@/components/loan-forms";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth/session";
import { listSchemes } from "@/server/loans/applications";
import { getMember } from "@/server/members";

export const metadata = { title: "New loan application" };

export default async function NewLoanPage({ searchParams }: { searchParams: Promise<{ member?: string; scheme?: string }> }) {
  await requirePermission("loan.manage");
  const sp = await searchParams;
  const member = sp.member ? await getMember(Number(sp.member)) : null;
  const schemes = await listSchemes({ openOnly: true });
  return (
    <>
      <PageHeader
        title="Loan application for a member"
        subtitle="For members who come to the office. It's recorded as made by you on their behalf."
        actions={<Link href={member ? `/members/${member.id}` : "/loans"} className="btn-secondary">Cancel</Link>}
      />
      <div className="card max-w-xl">
        <ApplyForm
          action={applyAction.bind(null, true)}
          schemes={schemes}
          member={member ? { id: member.id, label: `${member.memberNo} — ${member.fullName}${member.status !== "active" ? ` (${member.status})` : ""}` } : null}
          defaultSchemeId={sp.scheme}
        />
      </div>
    </>
  );
}
