import type { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4 } from "uuid";
import { ensureCollection } from "./client.js";

export const TICKETS_COLLECTION = "tickets";

export interface TicketPoint {
  ticketId: string;
  orgId: string;
  subject: string;
  status: string;
}

// Separate collection from articles rather than one collection with a
// "kind" payload field: tickets and articles are re-embedded/updated on
// completely different lifecycles (a ticket's vector goes stale on every
// new message; an article's is stable until edited), so keeping them apart
// avoids one workload's churn hurting the other's HNSW graph quality.
export class TicketVectorStore {
  constructor(
    private readonly qdrant: QdrantClient,
    private readonly vectorSize: number,
  ) {}

  async init(): Promise<void> {
    await ensureCollection(this.qdrant, TICKETS_COLLECTION, this.vectorSize);
  }

  async upsert(point: TicketPoint, vector: number[]): Promise<string> {
    const pointId = uuidv4();
    await this.qdrant.upsert(TICKETS_COLLECTION, {
      wait: true,
      points: [
        {
          id: pointId,
          vector,
          payload: {
            ticketId: point.ticketId,
            orgId: point.orgId,
            subject: point.subject,
            status: point.status,
          },
        },
      ],
    });
    return pointId;
  }

  async findSimilar(
    orgId: string,
    vector: number[],
    excludeTicketId: string,
    limit = 5,
  ): Promise<{ ticketId: string; score: number }[]> {
    const { points } = await this.qdrant.query(TICKETS_COLLECTION, {
      query: vector,
      limit: limit + 1,
      filter: { must: [{ key: "orgId", match: { value: orgId } }] },
      with_payload: true,
    });

    return points
      .map((r) => ({ ticketId: (r.payload as { ticketId: string }).ticketId, score: r.score }))
      .filter((r) => r.ticketId !== excludeTicketId)
      .slice(0, limit);
  }
}
