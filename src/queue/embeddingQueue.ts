import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const EMBEDDING_QUEUE_NAME = "embed-content";

export interface EmbedJobData {
  kind: "article" | "ticket";
  id: string;
  orgId: string;
  text: string;
}

// Embedding runs off the request path: a create/update returns as soon as
// Postgres has the row, and semantic search for that item becomes available
// once the worker catches up (typically sub-second) rather than making the
// API call to Ollama/the AI API part of every write's latency budget.
export function createEmbeddingQueue(connection: Redis): Queue<EmbedJobData> {
  return new Queue<EmbedJobData>(EMBEDDING_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    },
  });
}
