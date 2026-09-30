import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./types.js";

export function createDb(connectionString: string): Kysely<Database> {
  const pool = new pg.Pool({
    connectionString,
    // Bounded pool: a runaway request pattern should back-pressure and
    // queue at the pool, not open unbounded connections and take Postgres
    // down with it. 10 is a reasonable per-instance default for this
    // workload; it's the first knob to raise if p99 latency is dominated by
    // pool wait time rather than query time.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
