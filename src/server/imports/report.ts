/** The permanent, exportable status report for an import batch (.xlsx). */
import ExcelJS from "exceljs";
import { describeCode } from "@/lib/import-codes";
import { formatDateTime } from "@/lib/format";
import { formatPeriod } from "@/lib/period";
import { getBatchSummary, listBatchRows } from "./service";

const NAIRA = '"₦"#,##0.00';

export async function buildBatchReport(batchId: number): Promise<{ fileName: string; content: Buffer } | null> {
  const s = await getBatchSummary(batchId);
  if (!s) return null;
  const rows = await listBatchRows(batchId, "all");
  const b = s.batch;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Colowo";

  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 34 }, { width: 22 }, { width: 22 }];
  const line = (label: string, value: unknown, money = false, value2?: unknown) => {
    const r = sum.addRow([label, value, value2]);
    if (money) {
      r.getCell(2).numFmt = NAIRA;
      r.getCell(3).numFmt = NAIRA;
    }
    return r;
  };
  sum.addRow([`Deduction import #${b.id} — ${formatPeriod(b.period)}`]).font = { bold: true, size: 14 };
  sum.addRow([]);
  line("File", b.fileName);
  line("Status", b.status);
  line("Uploaded by", s.uploadedByName ?? "—");
  line("Uploaded at", formatDateTime(b.createdAt));
  line("Committed by", s.committedByName ?? "—");
  line("Committed at", b.committedAt ? formatDateTime(b.committedAt) : "—");
  sum.addRow([]);
  sum.addRow(["", "Rows", "Amount"]).font = { bold: true };
  const pair = (label: string, n: number, kobo: number) => {
    const r = sum.addRow([label, n, kobo / 100]);
    r.getCell(3).numFmt = NAIRA;
  };
  if (b.controlCount !== null || b.controlTotalKobo !== null) {
    pair("File's Grand Total (control)", b.controlCount ?? 0, b.controlTotalKobo ?? 0);
  }
  pair("Rows read from file (as received)", b.parsedCount, b.parsedTotalKobo);
  pair("Posted to savings", s.counts.posted, s.totals.posted);
  pair("Ready to post", s.counts.ok + s.counts.warning, s.totals.ok + s.totals.warning);
  pair("Held back (errors)", s.counts.error, s.totals.error);
  pair("Skipped by officer", s.counts.skipped, s.totals.skipped);
  if (b.structureErrors.length || b.notices.length) {
    sum.addRow([]);
    sum.addRow(["File problems"]).font = { bold: true };
    for (const e of b.structureErrors) sum.addRow([e]);
    for (const n of b.notices) sum.addRow([`Note: ${n}`]);
  }
  if (s.errorsByCode.length) {
    sum.addRow([]);
    sum.addRow(["Exceptions by type", "Rows", "Amount"]).font = { bold: true };
    for (const e of s.errorsByCode) pair(describeCode(e.code), e.count, e.totalKobo);
  }

  const detail = (name: string, list: typeof rows) => {
    const ws = wb.addWorksheet(name);
    ws.columns = [
      { header: "File row", key: "row", width: 9 },
      { header: "Section", key: "section", width: 12 },
      { header: "Employment no. (file)", key: "empRaw", width: 20 },
      { header: "Employment no. (used)", key: "emp", width: 20 },
      { header: "Verification no.", key: "ver", width: 16 },
      { header: "Name on file", key: "name", width: 24 },
      { header: "Amount (file)", key: "amountRaw", width: 14 },
      { header: "Amount (used)", key: "amount", width: 14, style: { numFmt: NAIRA } },
      { header: "Member no.", key: "memberNo", width: 12 },
      { header: "Member", key: "member", width: 28 },
      { header: "Outcome", key: "outcome", width: 14 },
      { header: "Problem", key: "problem", width: 48 },
      { header: "Warnings", key: "warnings", width: 40 },
      { header: "Note", key: "note", width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const { row: r, memberNo, memberName } of list) {
      ws.addRow({
        row: r.rowNumber,
        section: r.section,
        empRaw: r.employmentNoRaw,
        emp: r.employmentNo,
        ver: r.verificationNoRaw,
        name: r.nameRaw,
        amountRaw: r.amountRaw,
        amount: r.amountKobo === null ? null : r.amountKobo / 100,
        memberNo,
        member: memberName,
        outcome: r.postedAt ? "Posted" : r.resolution === "skipped" ? "Skipped" : r.status === "error" ? "Held back" : "Not yet posted",
        problem: [describeCode(r.errorCode), r.message].filter(Boolean).join(" — "),
        warnings: r.warnings.map(describeCode).join("; "),
        note: r.note,
      });
    }
    ws.autoFilter = { from: "A1", to: "N1" };
  };
  detail("Exceptions", rows.filter(({ row: r }) => !r.postedAt && (r.status !== "ok" || r.resolution !== "none")));
  detail("All rows", rows);

  const content = Buffer.from(await wb.xlsx.writeBuffer());
  return { fileName: `colowo-import-${b.id}-${b.period}.xlsx`, content };
}
