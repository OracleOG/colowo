/**
 * Reader for the Kaduna State Payroll "Deduction Details Employee-Department wise"
 * workbook, as emailed monthly by the bank.
 *
 *   Row ~3  title, ending with the month, e.g. "… COOP. SOC. May 2026"
 *   Row ~4  Ministry | DEDUCTION NAME | EMPLOYMENT NUMBER | VERIFICATION NO | EMPLOYEE NAME | AMOUNT | YTD
 *   then    section rows (e.g. "HEALTH"), member rows, "Sub Total" rows,
 *           and a "Grand Total | Count: 427 | 4038000" line.
 *
 * Columns are found by their header text, not position, so a reordered or
 * extra column doesn't break the import. Nothing here touches the database.
 */
import ExcelJS from "exceljs";
import { parseAmountToKobo } from "@/lib/money";
import { normalizeEmployeeNo } from "@/lib/normalize";
import { parsePeriodLabel, type Period } from "@/lib/period";

export const FORMAT_ID = "kaduna_payroll_v1";

const COLUMNS = {
  section: ["MINISTRY"],
  deductionName: ["DEDUCTION NAME", "DEDUCTION"],
  employmentNo: ["EMPLOYMENT NUMBER", "EMPLOYMENT NO", "EMPLOYEE NUMBER", "EMPLOYEE NO"],
  verificationNo: ["VERIFICATION NO", "VERIFICATION NUMBER"],
  name: ["EMPLOYEE NAME", "NAME"],
  amount: ["AMOUNT"],
  ytd: ["YTD", "YEAR TO DATE"],
} as const;
type ColumnKey = keyof typeof COLUMNS;
const REQUIRED: ColumnKey[] = ["employmentNo", "amount"];

export type ParsedRow = {
  rowNumber: number;
  section: string | null;
  employmentNoRaw: string | null;
  employmentNo: string | null;
  verificationNoRaw: string | null;
  nameRaw: string | null;
  amountRaw: string | null;
  amountKobo: number | null;
  ytdKobo: number | null;
  raw: Record<string, string | null>;
};

export type ParsedFile = {
  sheetName: string;
  period: Period | null;
  periodLabel: string | null;
  rows: ParsedRow[];
  controlCount: number | null;
  controlTotalKobo: number | null;
  /** Problems with the file as a whole. Any of these blocks commit. */
  structureErrors: string[];
  /** Things worth showing but not blocking. */
  notices: string[];
};

export class FileFormatError extends Error {}

/** Cell → trimmed text with non-breaking spaces normalised; null if empty. */
function cellText(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (typeof v === "object") {
    if (v instanceof Date) s = v.toISOString().slice(0, 10);
    else if ("richText" in v) s = v.richText.map((r) => r.text).join("");
    else if ("result" in v) return cellText((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    else if ("text" in v) s = String((v as ExcelJS.CellHyperlinkValue).text);
    else if ("error" in v) s = String((v as ExcelJS.CellErrorValue).error);
    else s = String(v);
  } else s = String(v);
  s = s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** Numeric cells stay numbers (so 5000 isn't re-parsed from text). */
function cellAmount(v: ExcelJS.CellValue): string | number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v && typeof v.result === "number") return v.result;
  return cellText(v);
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function findHeader(ws: ExcelJS.Worksheet): { row: number; cols: Partial<Record<ColumnKey, number>> } | null {
  const last = Math.min(ws.rowCount, 40);
  for (let r = 1; r <= last; r++) {
    const cols: Partial<Record<ColumnKey, number>> = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      const t = cellText(cell.value);
      if (!t) return;
      const n = norm(t);
      for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
        if (cols[key] === undefined && COLUMNS[key].some((label) => n === label)) cols[key] = c;
      }
    });
    if (REQUIRED.every((k) => cols[k] !== undefined)) return { row: r, cols };
  }
  return null;
}

function firstInt(s: string | null): number | null {
  const m = s && /(\d[\d,]*)/.exec(s);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

export async function parseKadunaPayroll(data: ArrayBuffer | Buffer): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as ArrayBuffer);
  } catch {
    throw new FileFormatError(
      "This file could not be read as an Excel workbook (.xlsx). If it is an old .xls file, open it in Excel and save it as .xlsx.",
    );
  }

  let ws: ExcelJS.Worksheet | undefined;
  let header: ReturnType<typeof findHeader> = null;
  for (const sheet of wb.worksheets) {
    header = findHeader(sheet);
    if (header) {
      ws = sheet;
      break;
    }
  }
  if (!ws || !header) {
    throw new FileFormatError(
      "Couldn't find the header row (EMPLOYMENT NUMBER … AMOUNT) in any sheet. Is this the payroll deduction file?",
    );
  }
  const { cols } = header;
  const at = (row: ExcelJS.Row, key: ColumnKey) => (cols[key] ? row.getCell(cols[key]!).value : null);

  // Period: look in the rows above the header (the title line ends with "May 2026").
  let period: Period | null = null;
  let periodLabel: string | null = null;
  for (let r = 1; r < header.row && !period; r++) {
    ws.getRow(r).eachCell((cell) => {
      const t = cellText(cell.value);
      const p = t && parsePeriodLabel(t);
      if (p && !period) {
        period = p;
        periodLabel = /\b[A-Za-z]+[\s,.'’-]*\d{4}\b/.exec(t!)?.[0] ?? t;
      }
    });
  }

  const rows: ParsedRow[] = [];
  const structureErrors: string[] = [];
  const notices: string[] = [];
  let section: string | null = null;
  let controlCount: number | null = null;
  let controlTotalKobo: number | null = null;
  let subTotalKobo = 0;
  let sawGrandTotal = false;

  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const texts: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const t = cellText(cell.value);
      if (t) texts.push(t);
    });
    if (!texts.length) continue;

    const label = norm(texts[0]);
    if (label.startsWith("GRAND TOTAL")) {
      sawGrandTotal = true;
      controlCount = firstInt(cellText(at(row, "employmentNo")));
      const total = parseAmountToKobo(cellAmount(at(row, "amount")));
      controlTotalKobo = total.ok ? total.kobo : null;
      break; // nothing after the grand total belongs to the file
    }
    if (label.startsWith("SUB TOTAL") || label.startsWith("SUBTOTAL")) {
      const t = parseAmountToKobo(cellAmount(at(row, "amount")));
      if (t.ok) subTotalKobo += t.kobo;
      continue;
    }

    const emp = cellText(at(row, "employmentNo"));
    const amount = cellAmount(at(row, "amount"));
    const sectionCell = cellText(at(row, "section"));
    if (!emp && amount === null) {
      // A section heading such as "HEALTH" (or stray text) — not a member row.
      if (sectionCell) section = sectionCell;
      continue;
    }

    const raw: Record<string, string | null> = {};
    for (const key of Object.keys(cols) as ColumnKey[]) raw[key] = cellText(at(row, key));
    const parsedAmount = parseAmountToKobo(amount);
    const ytd = parseAmountToKobo(cellAmount(at(row, "ytd")));
    rows.push({
      rowNumber: r,
      section: sectionCell ?? section,
      employmentNoRaw: emp,
      employmentNo: normalizeEmployeeNo(emp),
      verificationNoRaw: cellText(at(row, "verificationNo")),
      nameRaw: cellText(at(row, "name")),
      amountRaw: amount === null ? null : String(amount),
      amountKobo: parsedAmount.ok ? parsedAmount.kobo : null,
      ytdKobo: ytd.ok ? ytd.kobo : null,
      raw,
    });
  }

  if (!rows.length) structureErrors.push("No member rows were found below the header.");
  if (!period) notices.push("The month could not be read from the file's title; check the period carefully.");

  const parsedTotal = rows.reduce((s, r) => s + (r.amountKobo ?? 0), 0);
  if (!sawGrandTotal) {
    notices.push("No Grand Total line was found, so the file's completeness can't be checked against it.");
  } else {
    if (controlCount !== null && controlCount !== rows.length) {
      structureErrors.push(`The file's Grand Total says ${controlCount} members but ${rows.length} rows were read.`);
    }
    if (controlTotalKobo !== null && controlTotalKobo !== parsedTotal) {
      structureErrors.push(
        `The file's Grand Total is ${controlTotalKobo / 100} but the rows read add up to ${parsedTotal / 100}.`,
      );
    }
  }
  if (subTotalKobo && controlTotalKobo !== null && subTotalKobo !== controlTotalKobo) {
    notices.push(`Section sub-totals (${subTotalKobo / 100}) differ from the Grand Total (${controlTotalKobo / 100}).`);
  }

  return { sheetName: ws.name, period, periodLabel, rows, controlCount, controlTotalKobo, structureErrors, notices };
}
