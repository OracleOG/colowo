import { requirePermission } from "@/server/auth/session";
import { buildBatchReport } from "@/server/imports/report";

/** Download the batch status report as Excel. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("report.view");
  const report = await buildBatchReport(Number((await params).id));
  if (!report) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(report.content), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${report.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
