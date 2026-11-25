import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseConfigError } from "./config";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { colowoPool?: Pool };

function createPool(): Pool {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const problem = databaseConfigError(process.env.DATABASE_URL);
  if (problem) {
    // Fail every query with an explanation instead of a cryptic DNS error.
    const fail = () => Promise.reject(new Error(problem));
    p.connect = fail as unknown as Pool["connect"];
    p.query = fail as unknown as Pool["query"];
  }
  return p;
}

export const pool = globalForDb.colowoPool ?? createPool();

if (process.env.NODE_ENV !== "production") globalForDb.colowoPool = pool;

export const db = drizzle(pool, { schema });

export type Db = typeof db;
/** A transaction handle (same query API as `db`). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
