/**
 * Builds a workbook in the Kaduna State Payroll layout — for tests, demos and
 * the seed script. Mirrors the real file: non-breaking spaces, a title line
 * ending with the month, a ministry section row, and Sub/Grand Total lines.
 */
import ExcelJS from "exceljs";
import { parseAmountToKobo } from "@/lib/money";

export type SampleRow = {
  employmentNo: string | null;
  verificationNo?: string | null;
  name?: string | null;
  amount: number | string | null;
  ytd?: number | null;
};

const NBSP = " ";
const COOP = `${NBSP}BDTH STAFF M- PURPOSE COOP. SOC.`;

export async function buildKadunaPayrollFile(opts: {
  monthLabel: string; // "May 2026"
  rows: SampleRow[];
  ministry?: string;
  /** Override the Grand Total (to simulate a truncated/inconsistent file). */
  grandTotal?: { count: number; amount: number };
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A2").value = `${NBSP}KADUNA STATE PAYROLL`;
  ws.getCell("A3").value = `${NBSP}${NBSP}${NBSP}Deduction Details Employee-Department wise`;
  ws.getCell("E3").value = `${NBSP}${NBSP}BDTH STAFF M- PURPOSE COOP. SOC.${NBSP}${opts.monthLabel.replace(" ", NBSP)}`;
  const headers = [`Ministry ${NBSP}`, "DEDUCTION NAME", `EMPLOYMENT NUMBER${NBSP}`, `VERIFICATION NO${NBSP}`, `EMPLOYEE NAME${NBSP}`, `AMOUNT${NBSP}`, `YTD${NBSP}`];
  headers.forEach((h, i) => (ws.getRow(4).getCell(i + 1).value = h));
  ws.getCell("A5").value = opts.ministry ?? "HEALTH";

  let r = 6;
  let total = 0;
  for (const row of opts.rows) {
    ws.getCell(`B${r}`).value = COOP;
    ws.getCell(`C${r}`).value = row.employmentNo;
    ws.getCell(`D${r}`).value = row.verificationNo ? Number(row.verificationNo) : null;
    ws.getCell(`E${r}`).value = row.name ?? null;
    ws.getCell(`F${r}`).value = row.amount;
    ws.getCell(`G${r}`).value = row.ytd ?? (typeof row.amount === "number" ? row.amount * 12 : null);
    const parsed = parseAmountToKobo(row.amount);
    if (parsed.ok) total += parsed.kobo / 100;
    r++;
  }
  const count = opts.grandTotal?.count ?? opts.rows.length;
  const amount = opts.grandTotal?.amount ?? total;
  ws.getCell(`A${r}`).value = `Sub Total ${NBSP}`;
  ws.getCell(`C${r}`).value = `Head Count: ${count}`;
  ws.getCell(`F${r}`).value = amount;
  r++;
  ws.getCell(`A${r}`).value = "Grand Total";
  ws.getCell(`C${r}`).value = `Count: ${count}`;
  ws.getCell(`F${r}`).value = amount;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
