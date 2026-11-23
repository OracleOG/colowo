# Colowo — how the cooperative's data works today, and how Colowo will hold it

Source: `cooperative_sheet_overview.xlsx` (BDTH Staff Multipurpose Cooperative Society, Kaduna),
four sheets. Names in the sample are blanked; structure, formulas and amounts are real.

---

## 1. What is in the workbook

| Sheet | What it is | Key facts |
|---|---|---|
| `bank_monthly_sheet` | The monthly file from **Kaduna State Payroll** | One month (May 2026), 427 members, ₦4,038,000. One row per member. |
| `general deduction record` | Every member × every month (Aug 2019 – Dec 2022) | 423 rows, keyed by **File Number**, not the bank's number. Many notes typed into amount cells. |
| `peronal deduction` | One member's account (one sheet per member in the real workbook) | Savings by year with monthly interest; blocks for Regular Loan, Commodity Loan, Shares. |
| `summarries` | Per member, per year: savings, earnings, "actual" payout | Pulls from the personal workbooks via external links. Contains formula errors (section 4). |

### 1.1 Bank file layout (Kaduna State Payroll)

```
Row 2   KADUNA STATE PAYROLL
Row 3   Deduction Details Employee-Department wise | BDTH STAFF M- PURPOSE COOP. SOC. May 2026   ← period is here
Row 4   Ministry | DEDUCTION NAME | EMPLOYMENT NUMBER | VERIFICATION NO | EMPLOYEE NAME | AMOUNT | YTD
Row 5   HEALTH                                                          ← ministry section row
Row 6+  (blank) | BDTH STAFF M- PURPOSE COOP. SOC. | EMP0013145 | 8612464293 | (name) | 5000 | 60000
...     Sub Total | Head Count: 427 | 4038000 | 48456000               ← control totals per section
        Grand Total | Count: 427 | 4038000 | 48456000                  ← control totals for file
```

- Member key: **EMPLOYMENT NUMBER** (`EMP` + 7 digits). Secondary: **VERIFICATION NO** (10 digits).
- **One amount per member.** There is no savings/loan split in the file.
- Cells contain non-breaking spaces (`\xa0`) — parser must strip them.
- Head count and grand total give us **control totals** to verify the parse.
- YTD (year-to-date) is a free cross-check against what we have posted this year.

### 1.2 Savings interest rule (confirmed)

From the personal sheet formulas, recomputed independently and matched **to the kobo for all 7 years (2019–2025)**:

```
for each month m of year Y:
    interest[m]   = running_balance[m-1] × monthly_rate
    running_balance[m] = running_balance[m-1] + deduction[m] + interest[m]

opening running_balance for year Y = total contributions to date (principal only)
year's "earnings"                  = Σ interest[m]
monthly_rate = 0.42% (2019–2021), 0.50% (2022 onward)
```

Two important consequences:

1. Interest **compounds monthly within a year**, but the next year **starts again from contributions only** — earnings are never added to the savings balance.
2. The calculated earnings are **notional**. The `summarries` sheet then pays only a fraction as **"ACTUAL"**: **30% for 2023, 35% for 2024, 50% for 2025**. Column `2024/2025` adds the two years' actuals together.

So "interest" at this cooperative is really an **annual dividend**: a computed entitlement × a payout rate decided each year.

### 1.3 Loans and shares (structure only; sample member has none)

| Block | Columns | Reading |
|---|---|---|
| Regular loan | Date, B/F, Principal, Interest, Total (= P + I), Payment, Balance (= B/F + Total − Payment), Due date | Interest is **typed in**, not calculated, and added at disbursement → looks like **flat interest charged up front**. |
| Commodity loan | Same shape | Goods bought on credit from the cooperative, repaid by deduction. |
| Shares acquired | B/F, Amount, Total | Running total of shares bought. **Not in the MVP spec — needs adding.** |

## 2. How data flows today vs. in Colowo

```
TODAY                                         COLOWO
Bank Excel (EMP no.)                          Upload bank file
  │ retyped by hand                             │ parse + match EMP no. → member
General deduction record (File No.)             │ validate, review exceptions, commit
  │ retyped by hand                             ▼
Personal sheet per member (name)              One ledger of transactions
  │ external-link formulas                      │ (everything below is a query, not a copy)
Summaries (per year, % payout)                  ├─ member passbook (by year)
                                                ├─ yearly earnings + payout run
                                                └─ reports
```

Three identifiers for one person exist today — **EMP number** (bank), **File Number** (general record), **name** (personal sheet). Nothing links them except the officer's memory. Colowo keeps **one member record** with all of them attached.

## 3. Data model (ledger milestones)

Foundation tables (members, users, roles, audit log) already exist. Added next:

### 3.1 Member identifiers

```
members                 + file_no, verification_no (existing: employee_no = bank EMP number)
member_identifiers      id, member_id, kind, value_normalized, value_raw, source, valid_from, valid_to
                        kind ∈ employment_no | verification_no | file_no | legacy_sheet_name | legacy_other
                        unique (kind, value_normalized) for live members
```

The general record alone uses ~15 ID styles (`SP/956`, `CMD/001/41136`, `BDTH248`, `BDTH 248`, 8–12 digit numbers, `emp 1234567`). They are all kept as identifiers so historical rows can be matched, while imports match on `employment_no`.

### 3.2 Savings (contributions)

```
savings_transactions    id, member_id, period (yyyy-mm), txn_date, type, amount_kobo (signed),
                        source_batch_id, source_row_id, reverses_id, narration, created_by
                        type ∈ contribution | withdrawal | adjustment | reversal | migrated_opening
                        unique (member_id, period) where type = contribution and source is an import
                        append-only (DB trigger)
```

Savings balance = Σ amount. Earnings are **not** in this table (they never join the balance — see 1.2).

### 3.3 Earnings and dividends

```
earning_rates           year, month_from, monthly_rate (numeric)      e.g. 2019-01 0.0042, 2022-01 0.005
dividend_runs           id, year, payout_rate (e.g. 0.30), status draft|approved|posted|reversed,
                        total_computed_kobo, total_payout_kobo, created_by, approved_by, posted_at
dividend_lines          run_id, member_id, opening_principal_kobo, contributions_kobo,
                        computed_earnings_kobo, payout_kobo
dividend_payments       line_id, paid_on, method, reference      (if/when paid out) [CONFIRM]
```

- Earnings are computed by one pure function from the ledger (`computeYearEarnings(member, year)`), the same formula as 1.2, in exact decimal arithmetic and rounded to kobo **once per year**. Unit tests use the sample sheet's numbers.
- A member's page shows "earnings so far this year (estimate)" live, and past years' declared payouts.

### 3.4 Loans

```
loan_products           id, code (regular | commodity), interest_method (flat_upfront | reducing), default_rate, max_tenure_months
loan_accounts           id, member_id, product_id, principal_kobo, interest_kobo, tenure_months,
                        monthly_instalment_kobo, status, applied_at, approved_by/at, disbursed_at, due_date, closed_at
loan_transactions       id, loan_id, period, txn_date, type, amount_kobo (signed), source_batch_id, reverses_id, narration, created_by
                        type ∈ disbursement | interest_charge | repayment | adjustment | reversal | migrated_opening
                        append-only (DB trigger)
```

Outstanding = disbursement + interest − repayments, the same as the sheet's Balance column. Default method `flat_upfront` (matches the sheet) — `[CONFIRM]` rate per product.

### 3.5 Shares

```
share_transactions      id, member_id, txn_date, type (purchase | refund | adjustment | reversal | migrated_opening),
                        amount_kobo, units?, narration, created_by      append-only
```

### 3.6 Imports

```
import_batches          id, period, file_name, file_hash, stored_file_ref, format ('kaduna_payroll_v1'),
                        status uploaded|validated|in_review|committed|cancelled,
                        control_head_count, control_total_kobo, parsed_count, parsed_total_kobo,
                        uploaded_by, committed_by, committed_at
                        unique (file_hash) where status = committed
                        unique (period) where status = committed   [one payroll file per month — CONFIRM]
import_rows             id, batch_id, row_number, raw jsonb, ministry, employment_no, verification_no,
                        amount_kobo, ytd_kobo, member_id, status ok|error|warning, error_code,
                        resolution none|corrected|skipped|posted_later, allocation jsonb
```

## 4. Import logic for the Kaduna payroll file

1. **Parse.** Find the header row by its labels (not by position). Read the period from the title cell ("… May 2026") and require it to match the period the officer chose. Track ministry section rows. Stop at `Sub Total` / `Grand Total`, and record their head count and amount as control totals.
2. **Check the parse.** The number of rows parsed and the sum of amounts must equal the Grand Total line, or the batch can't proceed (`STRUCTURE_ERROR`).
3. **Match.** `EMPLOYMENT NUMBER` → `members.employee_no`. If that fails, try `VERIFICATION NO` (as a suggestion, not an automatic match).
4. **Validate.** Apply the spec's codes (`UNKNOWN_MEMBER`, `MEMBER_EXITED`, `DUPLICATE_IN_FILE`, `ALREADY_POSTED`, `AMOUNT_ANOMALY`, …), plus:
   - `YTD_MISMATCH` (warning): the bank's YTD ≠ what Colowo has posted this year + this amount.
5. **Allocate** each member's single amount (module `allocation.ts`, rule configurable — `[CONFIRM]`):
   - default: loan instalments due first (regular, then commodity), remainder to savings;
   - alternative: a fixed savings amount per member, the rest to loans.
6. **Review → commit** in one transaction. Exceptions stay on the batch; a row can be posted later and stays linked to it.

## 5. Migrating the history

| Source | Use |
|---|---|
| Personal sheets (one per member) | **Primary source.** Monthly contributions 2019–2025, loans, shares. |
| General deduction record | Cross-check monthly amounts 2019–2022, and the File Number ↔ member link. |
| Summaries | **Reconciliation only** — compare yearly totals, not imported (it has errors, below). |
| Old bank files | Optional cross-check for recent months. |

Steps:
1. Build the **identity map**: personal sheet name ↔ File Number ↔ EMP number. The cooperative will need to confirm unmatched names.
2. Load each personal sheet's monthly amounts as `contribution` rows (or an opening balance plus recent months).
3. Recompute every year's earnings in Colowo, and compare with the sheet (exact formula, so any difference is a data error).
4. Produce a discrepancy report for the finance office.

The general record's notes need deciding, one pattern at a time: `nil`, `***`, `°°°`, `paid off`, `2000/trns` (transfer), `5000/rfnd` (refund), `minus 28,266(loan)`, `DEMISED`, `opted out`, `20,000*`.

### Problems found in the current workbooks (will surface in reconciliation)

| Where | Problem | Effect |
|---|---|---|
| `summarries!H93` | Totals `H15:H92` instead of `H2:H92` | **2022 savings total understated by ₦8,956,000** (shows ₦26.45m, should be ₦35.41m) |
| `summarries!K4` | 2023 earnings point to the 2022 cell (`$F$80`) | Member gets 2022's figure for 2023 |
| Rows 24, 50, 52 | 2024 savings and earnings read from different rows | Savings and earnings may be from different years |
| Rows 6, 52, 61, 76 | Two different years read the same row | A year's figure repeated |
| Row 57 | Earnings read from an "EXITTED STAFF LIST" workbook | Different source from the rest |
| Row 2 | 2025 savings typed in (3,200,000) | Doesn't update if the sheet changes |
| General record | 3 duplicate File Numbers, 74 rows with no ID, 1 row with a name in the amount column | Can't be matched without help |

## 6. Questions this raises for the cooperative

1. **ID link:** is there a list that links File Number / name to the payroll EMP number? (This is the biggest migration task.)
2. **Single amount per member:** when a member has a loan, how is their one deduction split between savings and loan repayment today?
3. **Earnings payout:** who decides the yearly payout % (30%, 35%, 50%), and how is it paid — cash, transfer, credited to savings, or set against a loan? Is the unpaid part (70%, 65%, 50%) kept by the cooperative?
4. **"2024/2025":** were 2024 and 2025 paid together? Has 2025 been paid?
5. **Loans:** interest rates for regular and commodity loans; is interest always charged up front (flat)? Tenure? Can a member have both at once?
6. **Shares:** price per share, minimum holding, can shares be refunded on exit?
7. **Withdrawals:** can members withdraw savings while active, or only on exit?
8. **The notes in the general record** (`trns`, `rfnd`, `paid off`, `minus … (loan)`, `*`): what does each mean?
9. **More bank files:** a few more months (including one with a new joiner and an exit) to test the parser.
