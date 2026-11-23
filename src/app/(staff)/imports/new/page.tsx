import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { todayLagos } from "@/lib/format";
import { requirePermission } from "@/server/auth/session";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Upload bank file" };

export default async function NewImportPage() {
  await requirePermission("import.upload");
  return (
    <>
      <PageHeader
        title="Upload bank file"
        subtitle="The Kaduna State Payroll deduction file (.xlsx) for one month."
        actions={<Link href="/imports" className="btn-secondary">Cancel</Link>}
      />
      <div className="card max-w-xl">
        <UploadForm defaultPeriod={todayLagos().slice(0, 7)} />
        <div className="mt-6 border-t border-slate-100 pt-4 text-sm text-slate-500">
          <p className="font-medium text-slate-700">What happens next</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Every row is checked against the member register. Nothing is posted yet.</li>
            <li>You review the exceptions: correct a number, skip a row, or leave it held back.</li>
            <li>You commit. Valid rows go onto members&apos; savings in one step, and the status report is saved.</li>
          </ol>
        </div>
      </div>
    </>
  );
}
