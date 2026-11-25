/**
 * Local development database.
 *
 * If DATABASE_URL is not set (or is still the placeholder from .env.example),
 * Colowo runs its own PostgreSQL server from node_modules, storing data in
 * ./.data/postgres. Nothing to install or sign up for. Set DATABASE_URL to use
 * any other Postgres (e.g. Neon) instead.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

const DATA_DIR = path.resolve(".data");
const PG_DIR = path.join(DATA_DIR, "postgres");
const SECRET_FILE = path.join(DATA_DIR, "session-secret");
const PORT = Number(process.env.LOCAL_DB_PORT ?? 54329);
const LOCAL_URL = `postgres://postgres:postgres@localhost:${PORT}/colowo`;

type Embedded = import("embedded-postgres").default;

export function loadEnv() {
  config({ path: ".env.local", quiet: true });
}

/** True when no real database has been configured. */
export function wantsLocalDatabase(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return true;
  try {
    const host = new URL(url).hostname;
    return host === "host" || host === ""; // placeholder from .env.example
  } catch {
    return true;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Remove a lock file left behind if the computer or terminal was closed abruptly. */
function clearStaleLock() {
  const pidFile = path.join(PG_DIR, "postmaster.pid");
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8").split("\n")[0]);
  if (!pid || !pidAlive(pid)) rmSync(pidFile);
}

export async function startLocalDatabase(): Promise<{ stop: () => Promise<void>; url: string }> {
  if (process.getuid?.() === 0) {
    throw new Error(
      "The built-in database can't run as the root user. Run as your normal user, or set DATABASE_URL to an existing Postgres.",
    );
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  mkdirSync(DATA_DIR, { recursive: true });
  const firstRun = !existsSync(path.join(PG_DIR, "PG_VERSION"));

  const pg: Embedded = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    port: PORT,
    user: "postgres",
    password: "postgres",
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: (e) => {
      const msg = String(e);
      if (/error|fatal/i.test(msg) && !/database "colowo" already exists/.test(msg)) console.error(`[database] ${msg.trim()}`);
    },
  });

  if (firstRun) {
    console.log("• Setting up the local database (first run only)…");
    await pg.initialise();
  }
  clearStaleLock();
  try {
    await pg.start();
  } catch (err) {
    throw new Error(
      `Couldn't start the local database on port ${PORT}. Is another "npm run dev" already running? ` +
        `Close it first, or set LOCAL_DB_PORT to a free port.\n${String(err)}`,
    );
  }
  if (firstRun) await pg.createDatabase("colowo");
  else {
    try {
      await pg.createDatabase("colowo");
    } catch {
      /* already exists */
    }
  }
  return { stop: () => pg.stop(), url: LOCAL_URL };
}

/** A stable session secret for local development, created once. */
export function ensureDevSessionSecret() {
  if ((process.env.SESSION_SECRET ?? "").length >= 32) return;
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(48).toString("base64"));
  process.env.SESSION_SECRET = readFileSync(SECRET_FILE, "utf8").trim();
}

/**
 * Run `fn` with DATABASE_URL pointing at a working database: the configured one,
 * or the built-in local one (started for the duration of `fn`).
 */
export async function withDatabase<T>(fn: () => Promise<T>): Promise<T> {
  loadEnv();
  if (!wantsLocalDatabase()) return fn();
  const local = await startLocalDatabase();
  process.env.DATABASE_URL = local.url;
  try {
    return await fn();
  } finally {
    await local.stop();
  }
}

export const LOCAL_DATA_DIR = DATA_DIR;
