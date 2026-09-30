import type { Kysely } from "kysely";
import type { Database, TicketStatus } from "../../db/types.js";

export class TicketsRepo {
  constructor(private readonly db: Kysely<Database>) {}

  create(input: { orgId: string; customerId: string; subject: string }) {
    return this.db
      .insertInto("tickets")
      .values({ org_id: input.orgId, customer_id: input.customerId, subject: input.subject })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findById(orgId: string, id: string) {
    return this.db
      .selectFrom("tickets")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  // Hits the tickets_org_open_queue partial index defined in migration 003:
  // an index that only covers open/pending rows stays small regardless of
  // how many tickets get closed over the app's lifetime.
  listOpenQueue(orgId: string, limit = 50) {
    return this.db
      .selectFrom("tickets")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("status", "in", ["open", "pending"])
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  updateStatus(orgId: string, id: string, status: TicketStatus) {
    return this.db
      .updateTable("tickets")
      .set({
        status,
        updated_at: new Date(),
        resolved_at: status === "resolved" ? new Date() : null,
      })
      .where("org_id", "=", orgId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  addMessage(input: { ticketId: string; authorId: string; body: string }) {
    return this.db
      .insertInto("ticket_messages")
      .values({ ticket_id: input.ticketId, author_id: input.authorId, body: input.body })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Ordered by the ticket_messages_thread index (ticket_id, created_at) -
  // an index-only range scan, not a sort.
  listMessages(ticketId: string) {
    return this.db
      .selectFrom("ticket_messages")
      .selectAll()
      .where("ticket_id", "=", ticketId)
      .orderBy("created_at", "asc")
      .execute();
  }

  findManyByIds(orgId: string, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom("tickets")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("id", "in", ids)
      .execute();
  }

  // Single-index-lookup stats via the materialized view from migration 005,
  // instead of aggregating the live tickets table on every dashboard load.
  statsForOrg(orgId: string) {
    return this.db
      .selectFrom("ticket_stats_by_org")
      .selectAll()
      .where("org_id", "=", orgId)
      .executeTakeFirst();
  }
}
