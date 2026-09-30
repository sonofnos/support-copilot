import type { Kysely } from "kysely";
import type { Database } from "../../db/types.js";

export class WebhooksRepo {
  constructor(private readonly db: Kysely<Database>) {}

  // Returns true if this is the first time we've seen (provider, eventId).
  // Relies on the unique index from migration 004 - a concurrent duplicate
  // delivery loses the insert race with a real Postgres 23505, which is
  // caught by the caller and treated as "already processed", not an error.
  async recordEventOnce(provider: string, eventId: string, payload: unknown): Promise<boolean> {
    try {
      await this.db
        .insertInto("webhook_events")
        .values({ provider, provider_event_id: eventId, payload: JSON.stringify(payload) })
        .execute();
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505";
}
