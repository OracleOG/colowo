import Link from "next/link";
import { logoutAction } from "../actions";

export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-md text-center">
        <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-slate-500">Ask an administrator if you think you should.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Link href="/" className="btn-secondary">Home</Link>
          <form action={logoutAction}><button className="btn-secondary">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}
