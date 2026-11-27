import Link from "next/link";
import { redirect } from "next/navigation";
import { STAFF_PERMISSIONS } from "@/lib/permissions";
import { requireUser } from "@/server/auth/session";
import { logoutAction } from "../actions";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!STAFF_PERMISSIONS.some((p) => user.permissions.has(p))) redirect(user.memberId ? "/me" : "/forbidden");

  const nav = [
    { href: "/members", label: "Members", show: user.permissions.has("member.view") },
    { href: "/imports", label: "Deduction imports", show: user.permissions.has("import.upload") },
    { href: "/loans", label: "Loans", show: user.permissions.has("loan.manage") || user.permissions.has("loan.approve") },
    { href: "/audit", label: "Audit log", show: user.permissions.has("audit.view") },
  ].filter((n) => n.show);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold text-brand-700">Colowo</Link>
          <nav className="flex gap-4 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="text-slate-600 hover:text-slate-900">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span>{user.displayName}</span>
            <form action={logoutAction}>
              <button className="text-slate-600 underline-offset-2 hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
