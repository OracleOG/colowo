import { redirect } from "next/navigation";
import { MemberTransactionList, Passbook } from "@/components/savings";
import { StatusBadge } from "@/components/ui";
import { formatDate, formatKobo } from "@/lib/format";
import { requirePermission } from "@/server/auth/session";
import { getMember } from "@/server/members";
import { getPassbook, getSavingsBalance, listSavingsTransactions } from "@/server/savings/ledger";
import { logoutAction } from "../actions";

export const metadata = { title: "My account" };

/**
 * Member self-service. The member id comes from the session only — never
 * from the URL — so a member can only ever load their own record.
 */
export default async function MePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requirePermission("self.view");
  if (!user.memberId) redirect("/");
  const member = await getMember(user.memberId);
  if (!member) redirect("/forbidden");

  const [balance, passbook] = await Promise.all([getSavingsBalance(member.id), getPassbook(member.id)]);
  const years = passbook.map((y) => y.year);
  const requested = Number((await searchParams).year);
  const year = years.includes(requested) ? requested : years[0];
  const txns = year ? await listSavingsTransactions(member.id, { year }) : [];
  const current = passbook.find((y) => y.inProgress);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <span className="text-lg font-bold text-brand-700">Colowo</span>
        <form action={logoutAction}><button className="text-sm text-slate-600 hover:underline">Sign out</button></form>
      </header>

      <section className="mb-4">
        <h1 className="text-xl font-semibold">{member.fullName}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
          <span className="font-mono">{member.memberNo}</span>
          <StatusBadge status={member.status} />
          <span>Member since {formatDate(member.dateJoined)}</span>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card">
          <h2 className="text-sm font-medium text-slate-500">Savings balance</h2>
          <p className="mt-1 text-3xl font-semibold">{formatKobo(balance)}</p>
          {current && (
            <p className="mt-2 text-sm text-slate-600">
              Earnings {current.year} so far: <strong>{formatKobo(current.earningsKobo)}</strong>
            </p>
          )}
        </section>
        <section className="card">
          <h2 className="text-sm font-medium text-slate-500">Loans</h2>
          <p className="mt-1 text-sm text-slate-400">Loan balances will appear here soon.</p>
        </section>
      </div>

      <section className="card mt-4">
        <h2 className="mb-3 font-semibold">Savings by year</h2>
        <Passbook years={passbook} />
      </section>

      {year && (
        <section className="card mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Transactions in {year}</h2>
            <form className="flex gap-2">
              <select name="year" defaultValue={year} className="input w-auto py-1">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button className="btn-secondary py-1">Show</button>
            </form>
          </div>
          <MemberTransactionList lines={txns} />
        </section>
      )}

      <section className="card mt-4 text-sm">
        <h2 className="mb-2 font-semibold">My details</h2>
        <dl className="grid grid-cols-2 gap-2">
          <dt className="text-slate-500">Employment no.</dt><dd className="font-mono">{member.employeeNo ?? "—"}</dd>
          <dt className="text-slate-500">Phone</dt><dd>{member.phone ?? "—"}</dd>
          <dt className="text-slate-500">Email</dt><dd className="break-all">{member.email ?? "—"}</dd>
        </dl>
        <p className="mt-3 text-xs text-slate-500">If anything looks wrong, contact the cooperative&apos;s finance office.</p>
      </section>
    </div>
  );
}
