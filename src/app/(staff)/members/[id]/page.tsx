import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditTable } from "@/components/audit-table";
import { Alert, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, formatKobo, todayLagos } from "@/lib/format";
import { listAudit } from "@/server/audit-queries";
import { requirePermission } from "@/server/auth/session";
import { memberHasLogin } from "@/server/auth/users";
import { getMember } from "@/server/members";
import { Passbook, TransactionList } from "@/components/savings";
import { getPassbook, getSavingsBalance, listSavingsTransactions } from "@/server/savings/ledger";
import { changeStatusAction, createLoginAction, manualEntryAction, reverseTxnAction, updateMemberAction } from "../actions";
import { MemberForm } from "../member-form";
import { LoginForm, ManualEntryForm, ReverseForm, StatusForm } from "./member-actions";

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requirePermission("member.view");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) notFound();
  const member = await getMember(id);
  if (!member) notFound();
  const { created } = await searchParams;

  const canManage = user.permissions.has("member.manage");
  const canSeeLedger = user.permissions.has("ledger.view");
  const [history, hasLogin, balance, passbook, txns] = await Promise.all([
    user.permissions.has("audit.view") ? listAudit({ entityType: "member", entityId: String(id), limit: 50 }) : null,
    memberHasLogin(id),
    canSeeLedger ? getSavingsBalance(id) : null,
    canSeeLedger ? getPassbook(id) : [],
    canSeeLedger ? listSavingsTransactions(id) : [],
  ]);
  const canAdjust = user.permissions.has("ledger.adjust");

  return (
    <>
      <PageHeader
        title={member.fullName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{member.memberNo}</span>
            <StatusBadge status={member.status} />
            <span>Joined {formatDate(member.dateJoined)}</span>
            {member.dateExited && <span>· Exited {formatDate(member.dateExited)}</span>}
          </span>
        }
        actions={<Link href="/members" className="btn-secondary">Back to members</Link>}
      />
      {created && <div className="mb-4"><Alert kind="success">Member {member.memberNo} created.</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="mb-4 font-semibold">Details</h2>
          <MemberForm
            action={updateMemberAction.bind(null, id)}
            initial={member}
            submitLabel="Save changes"
            readOnly={!canManage}
          />
        </section>

        <div className="space-y-6">
          {balance !== null && (
            <section className="card">
              <h2 className="text-sm font-medium text-slate-500">Savings balance</h2>
              <p className="mt-1 text-2xl font-semibold">{formatKobo(balance)}</p>
              {passbook[0]?.inProgress && (
                <p className="mt-1 text-sm text-slate-500">
                  Earnings {passbook[0].year} to date: {formatKobo(passbook[0].earningsKobo)}
                </p>
              )}
              <p className="mt-3 text-sm text-slate-400">Loans: coming in the next milestone.</p>
            </section>
          )}

          {canManage && member.status !== "exited" && (
            <section className="card">
              <h2 className="mb-4 font-semibold">Status</h2>
              <StatusForm action={changeStatusAction.bind(null, id)} status={member.status} today={todayLagos()} />
            </section>
          )}

          {user.permissions.has("user.manage") && (
            <section className="card">
              <h2 className="mb-4 font-semibold">Member login</h2>
              {hasLogin ? (
                <p className="text-sm text-slate-600">
                  This member can sign in with <span className="font-mono">{member.memberNo}</span>.
                </p>
              ) : (
                <LoginForm action={createLoginAction.bind(null, id)} />
              )}
            </section>
          )}
        </div>
      </div>

      {canSeeLedger && (
        <section className="card mt-6">
          <h2 className="mb-4 font-semibold">Savings by year</h2>
          <Passbook years={passbook} />
        </section>
      )}

      {canSeeLedger && (
        <section className="card mt-6">
          <h2 className="mb-4 font-semibold">Savings transactions</h2>
          <TransactionList
            lines={txns}
            staffLinks
            renderAction={
              canAdjust
                ? (t) =>
                    t.type !== "reversal" && !t.reversedById ? <ReverseForm action={reverseTxnAction.bind(null, id, t.id)} /> : null
                : undefined
            }
          />
          {user.permissions.has("ledger.manual_entry") && (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <h3 className="mb-3 text-sm font-semibold">Record a manual transaction</h3>
              <ManualEntryForm
                action={manualEntryAction.bind(null, id)}
                canAdjust={canAdjust}
                defaultPeriod={todayLagos().slice(0, 7)}
                today={todayLagos()}
              />
            </div>
          )}
        </section>
      )}

      {history && (
        <section className="card mt-6">
          <h2 className="mb-4 font-semibold">History</h2>
          <AuditTable rows={history} showEntity={false} />
        </section>
      )}
    </>
  );
}
