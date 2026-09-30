import { Worker } from "bullmq";
import { env as processEnv, type Env } from "../config/env.js";
import { wireAiClients } from "../ai/di.js";
import { createDb } from "../db/pool.js";
import { createQdrant } from "../qdrant/client.js";
import { ArticleVectorStore } from "../qdrant/articlesCollection.js";
import { TicketVectorStore } from "../qdrant/ticketsCollection.js";
import { createRedis } from "../redis/client.js";
import { EMBEDDING_QUEUE_NAME, type EmbedJobData } from "./embeddingQueue.js";
import { logger } from "../logger.js";

export interface EmbeddingWorkerHandle {
  worker: Worker<EmbedJobData>;
  waitUntilReady: () => Promise<void>;
  // Closes the worker AND the db/redis connections it opened for itself.
  // Just calling `worker.close()` leaves those idle - harmless in the
  // long-running CLI process (this is the whole process's lifetime
  // anyway), but a real leak in tests that spin up a worker per test: the
  // leaked pg.Pool keeps idle sockets open, and when the test's Postgres
  // Testcontainer stops, those sockets error out with nothing listening,
  // crashing the test run with "terminating connection due to
  // administrator command" (found by running the actual integration suite,
  // not by inspection).
  close: () => Promise<void>;
}

// Takes `env` explicitly (defaulting to the process's own) rather than
// importing the singleton directly, so integration tests can point a real
// worker at their ephemeral Testcontainers instances instead of whatever
// DATABASE_URL/REDIS_URL happen to be in process.env.
export async function buildEmbeddingWorker(env: Env = processEnv): Promise<EmbeddingWorkerHandle> {
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const qdrant = createQdrant(env.QDRANT_URL, env.QDRANT_API_KEY);
  const ai = await wireAiClients(env);

  const articleStore = new ArticleVectorStore(qdrant, ai.embeddings.dimensions);
  const ticketStore = new TicketVectorStore(qdrant, ai.embeddings.dimensions);
  await Promise.all([articleStore.init(), ticketStore.init()]);

  logger.info({ backend: ai.backend }, "embedding worker using AI backend");

  const worker = new Worker<EmbedJobData>(
    EMBEDDING_QUEUE_NAME,
    async (job) => {
      const vector = await ai.embeddings.embed(job.data.text);

      if (job.data.kind === "article") {
        const pointId = await articleStore.upsert(
          { articleId: job.data.id, orgId: job.data.orgId, title: job.data.text.slice(0, 120) },
          vector,
        );
        await db.updateTable("articles").set({ qdrant_point_id: pointId }).where("id", "=", job.data.id).execute();
      } else {
        const pointId = await ticketStore.upsert(
          { ticketId: job.data.id, orgId: job.data.orgId, subject: job.data.text.slice(0, 120), status: "open" },
          vector,
        );
        await db.updateTable("tickets").set({ qdrant_point_id: pointId }).where("id", "=", job.data.id).execute();
      }
    },
    { connection: redis, concurrency: 4 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "embedding job failed");
  });

  return {
    worker,
    waitUntilReady: async () => {
      await worker.waitUntilReady();
    },
    close: async () => {
      await worker.close();
      await db.destroy();
      void redis.quit();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildEmbeddingWorker().then(() => logger.info("embedding worker started"));
}
