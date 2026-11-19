import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { todayLagos } from "@/lib/format";
import { requirePermission } from "@/server/auth/session";
import { createMemberAction } from "../actions";
import { MemberForm } from "../member-form";

export const metadata = { title: "Add member" };

export default async function NewMemberPage() {
  await requirePermission("member.manage");
  return (
    <>
      <PageHeader
        title="Add member"
        subtitle="A member number is issued automatically and can never change."
        actions={<Link href="/members" className="btn-secondary">Cancel</Link>}
      />
      <div className="card max-w-3xl">
        <MemberForm action={createMemberAction} initial={{ fullName: "", dateJoined: todayLagos() }} submitLabel="Create member" />
      </div>
    </>
  );
}
