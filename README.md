# Colowo

Cooperative records management: member register, monthly bank deduction imports,
savings and loan ledgers, interest runs and reports. Next.js + PostgreSQL.

See [`docs/PLAN.md`](docs/PLAN.md) for decisions, milestones and open questions.

## Run locally

Requires **Node.js 20+** and Git. No database to install or sign up for.

```bash
git clone -b milestone-1-foundation https://github.com/OracleOG/colowo.git
cd colowo
npm install
npm run dev
```

The first `npm run dev` takes about a minute: it starts a built-in PostgreSQL
server (data kept in `.data/postgres`), creates the tables, loads demo data
(~520 fake members with savings history) and writes a demo bank file to
`demo-files/`. After that it starts in seconds and keeps your data.
Open **http://localhost:3000**. Stop with **Ctrl+C**.

| Login | Password | Role |
|---|---|---|
| admin@colowo.local | Colowo!2026 | Admin (everything) |
| finance@colowo.local | Colowo!2026 | Finance officer (imports, savings) |
| loans@colowo.local | Colowo!2026 | Loan officer (loans on members' behalf) |
| approver@colowo.local | Colowo!2026 | Loan approver (offers, schemes) |
| board@colowo.local | Colowo!2026 | Viewer |
| CLW00001 | Member!2026 | Member (must change password; has a loan offer waiting) |

**Try an import:** sign in as the finance officer → *Deduction imports* → *Upload bank file* →
month **October 2026** → `demo-files/bank-file-october-2026.xlsx`. It contains a few deliberate
problems (unknown number, blank amount, duplicate, exited member, unusual amount).

Useful commands:

| Command | What it does |
|---|---|
| `npm run db:reset` | Delete the local database and demo files; next `npm run dev` starts fresh |
| `npm run demo:bank-file -- 2026-11 demo-files/nov.xlsx` | Make another demo bank file (stop `npm run dev` first) |

To use your own Postgres (e.g. Neon) instead of the built-in one, put
`DATABASE_URL=...` in `.env.local`. The built-in database can't run as the root user.

## Tests

Tests run against a separate database (`TEST_DATABASE_URL`, default
`postgres://postgres@localhost:5433/colowo_test`), which is wiped on each run.

```bash
npm test
```

## Deploy (Vercel + Neon)

1. Create a Neon project; copy the **pooled** connection string.
2. Import the repo in Vercel; set `DATABASE_URL`, `SESSION_SECRET` (`openssl rand -base64 48`) and `MEMBER_NO_PREFIX`.
3. Run `npm run db:migrate` with Neon's URL as `DATABASE_URL` in `.env.local`, to create the tables there.
4. Create the first admin with a one-off script — do not run the demo seed in production.

## Layout

```
drizzle/            SQL migrations (generated + hand-written integrity triggers)
scripts/            migrate, seed
src/db/             schema and connection
src/lib/            pure helpers: money, formatting, normalisation, permissions
src/server/         business logic (members, auth, audit) — all writes go through here
src/app/            pages and server actions
tests/              vitest (unit + database)
```

---

## Long-term vision

The MVP above is the first phase. The wider vision for the platform:


A digital platform designed to help cooperative societies automate and manage their financial and business activities in one place.

This system brings together fintech automation and enterprise resource management tools to make cooperatives more transparent, efficient, and scalable.

### 🔑 Core Features

*** Automated Savings Deductions: Periodic contributions linked to members’ bank accounts or payroll systems.

*** Wallet & Balance Tracking: Real-time view of member balances, with filters for savings, loans, and investments.

*** Loan Management: Members can apply for loans, view repayment schedules, and track automatic deductions.

*** Share Purchase & Investments: Buy cooperative shares and invest pooled funds in approved opportunities or stock market APIs.

*** Business Operations Module: For cooperatives that own businesses — manage inventory, billing, invoicing, and cashflow.

*** Reporting & Dashboards: Visual summaries for members and admins to track performance, funds, and investments.

#### ⚙️ Technology Overview

Built as a modular fintech-ERP hybrid, the platform integrates:

Fintech APIs (e.g. Paystack, Moniepoint, Flutterwave) for payments and deductions

ERP-style tools for inventory, accounting, and financial reporting

Modern tech stack: React/React Native frontend, Node.js or Django backend, PostgreSQL database

#### 🧩 Vision

To digitize and empower local cooperatives by providing an all-in-one system for savings, loans, investments, and cooperative-owned business management — bringing transparency, automation, and financial growth to member-based organizations.
