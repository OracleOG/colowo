# Colowo — build plan and working notes

The MVP specification (scope, rules, data model) is the source of truth. This file
records decisions, the cooperative's current Excel workflow, and open questions.

## Decisions

| Area | Decision |
|---|---|
| App | Next.js 15 (App Router, TypeScript), server actions for writes |
| Hosting | Vercel Hobby while building/demoing. Hobby is for non-commercial use: plan for Vercel Pro (~$20/mo) or another host once the cooperative depends on it. |
| Database | PostgreSQL — Neon free tier in the cloud; plain Postgres locally |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL migrations in `drizzle/`) |
| Auth | Own email/member-number + password login, signed session cookie (jose), bcrypt hashes, lockout after 5 failures |
| Roles | Named permissions (`src/lib/permissions.ts`) grouped into roles: member, finance_officer, admin, viewer |
| Money | Integer kobo everywhere (`src/lib/money.ts`) |
| Integrity | Enforced in the database, not just the app: unique member numbers, immutable `member_no`, no member deletes, append-only audit log (and, later, ledgers) |
| Backups | Nightly `pg_dump` via GitHub Actions (to add before go-live) |

## Current workflow (Excel), as described by the cooperative

1. **Bank deduction file** (Excel), emailed monthly by the bank: deductions for all members for that month.
2. **General deduction file**: one workbook listing every member by name, with a column per month; each month's bank figures are copied in by hand.
3. **Personal deduction file**: one sheet per member — that member's monthly deductions and an **interest calculation**.
4. **Yearly summary**: totals from each personal sheet are pulled into a total summary for the year and total interest for the year.
5. **Loans**: application, loan interest calculation, recorded repayment deductions and balance.

How Colowo replaces each step:

| Excel step | Colowo |
|---|---|
| Bank file → general deduction file | Deduction import: upload, validate against the member register, review exceptions, commit (Milestone 2) |
| General → personal sheets | Not needed: each member's history is a query over the savings ledger (Milestone 3) |
| Interest on personal sheet | Interest run: draft → review → post, tagged per member (Milestone 5) |
| Yearly totals/summary | Savings report + passbook view per year (Milestones 3, 6) |
| Loan workbook | Loan accounts + loan ledger + approvals (Milestone 4) |

The real workbooks will be reviewed before the ledger schema is finalised (to be supplied).

## Milestones

1. **Foundation — done:** auth, roles, audit log, member register (create/edit/search, suspend/exit, duplicate checks), member self-service page, seed data, tests.
2. Deduction import pipeline (needs the sample bank file).
3. Savings ledger, balances, passbook, member statement.
4. Loans.
5. Interest runs.
6. Reports + Excel/PDF export.
7. Historical migration from the workbooks.
8. Hardening, backups, UAT, go-live.

## Spec amendments

- `import_batches.file_hash` unique **only among committed batches** (partial index), so a cancelled/rejected file can be re-uploaded.
- After commit, an error row can still be posted later via a "post held-back row" action, linked to the original import row.
- Loan repayments: one import-sourced repayment per loan per period.
- Anomaly check baseline: median of the member's last 3–6 posted deductions; skipped without history.
- `members.legacy_ref` added to map members to their old workbook sheet during migration.

## Open questions for the cooperative

**Blocking Milestone 2–3 (need answers or files):**
1. Sample bank deduction file — exact columns, header rows, one total per member or savings/loan split?
2. The general deduction, personal deduction and loan workbooks.
3. How is interest on the personal sheets calculated (rate, monthly vs yearly, on what balance)?
4. Loan interest: flat or reducing balance? Rate, tenure, how the monthly repayment is set.

**Can stay configurable for now:** member number format (currently `CLW00001`), exit/settlement rules,
whether exited members can rejoin (currently: no), withdrawal rules, suspended-member deductions,
loan eligibility, how business/shop income is shared, member login method (currently password).
