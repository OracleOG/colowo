import Link from "next/link";
import { logoutAction } from "@/app/actions";

/** Phone-first frame for member pages. */
export function MemberShell({ children, back }: { children: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/me" className="text-lg font-bold text-brand-700">Colowo</Link>
        <form action={logoutAction}><button className="text-sm text-slate-600 hover:underline">Sign out</button></form>
      </header>
      {back && <Link href={back.href} className="mb-3 inline-block text-sm text-brand-700 hover:underline">← {back.label}</Link>}
      {children}
    </div>
  );
}
