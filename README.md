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
