# Colowo

Cooperative records management: member register, monthly bank deduction imports,
savings and loan ledgers, interest runs and reports. Next.js + PostgreSQL.

See [`docs/PLAN.md`](docs/PLAN.md) for decisions, milestones and open questions.

## Run locally

Requires Node 20+ and PostgreSQL 15+.

```bash
npm install
cp .env.example .env.local   # then set DATABASE_URL and SESSION_SECRET
npm run db:migrate
npm run db:seed              # demo logins + ~520 fake members (never in production)
npm run dev
```

Demo logins after seeding:

| Login | Password | Role |
|---|---|---|
| admin@colowo.local | Colowo!2026 | Admin |
| finance@colowo.local | Colowo!2026 | Finance officer |
| board@colowo.local | Colowo!2026 | Viewer |
| CLW00001 | Member!2026 | Member (must change password) |

## Tests

Tests run against a separate database (`TEST_DATABASE_URL`, default
`postgres://postgres@localhost:5433/colowo_test`), which is wiped on each run.

```bash
npm test
```

## Deploy (Vercel + Neon)

1. Create a Neon project; copy the **pooled** connection string.
2. Import the repo in Vercel; set `DATABASE_URL`, `SESSION_SECRET` (`openssl rand -base64 48`) and `MEMBER_NO_PREFIX`.
3. Run `npm run db:migrate` against the Neon database (locally with its URL in `.env.local`, or from CI).
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
