import { requirePermission } from "@/server/auth/session";
import { getBatchFile } from "@/server/imports/service";

/** Download the original bank file exactly as uploaded. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("import.upload");
  const file = await getBatchFile(Number((await params).id));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
