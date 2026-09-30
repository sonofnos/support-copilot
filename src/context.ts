import type { Kysely } from "kysely";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { QdrantClient } from "@qdrant/js-client-rest";
import type { Database } from "./db/types.js";
import type { EmbeddingClient } from "./ai/embeddings/EmbeddingClient.js";
import type { LlmClient } from "./ai/llm/LlmClient.js";
import { wireAiClients } from "./ai/di.js";
import { createDb } from "./db/pool.js";
import { createRedis } from "./redis/client.js";
import { createQdrant } from "./qdrant/client.js";
import { ArticleVectorStore } from "./qdrant/articlesCollection.js";
import { TicketVectorStore } from "./qdrant/ticketsCollection.js";
import { CacheAside } from "./redis/cache.js";
import { TokenBucketRateLimiter } from "./redis/rateLimiter.js";
import { TicketEventPublisher, TicketEventSubscriber } from "./redis/pubsub.js";
import { TokenService } from "./auth/jwt.js";
import { createEmbeddingQueue, type EmbedJobData } from "./queue/embeddingQueue.js";
import { OrgsRepo } from "./modules/orgs/orgsRepo.js";
import { AuthRepo } from "./modules/auth/authRepo.js";
import { ArticlesRepo } from "./modules/articles/articlesRepo.js";
import { TicketsRepo } from "./modules/tickets/ticketsRepo.js";
import { WebhooksRepo } from "./modules/webhooks/webhooksRepo.js";
import type { Env } from "./config/env.js";

export interface AppContext {
  db: Kysely<Database>;
  redis: Redis;
  qdrant: QdrantClient;
  embeddings: EmbeddingClient;
  llm: LlmClient;
  aiBackend: string;
  tokens: TokenService;
  embeddingQueue: Queue<EmbedJobData>;
  articleStore: ArticleVectorStore;
  ticketStore: TicketVectorStore;
  searchCache: CacheAside;
  loginLimiter: TokenBucketRateLimiter;
  publisher: TicketEventPublisher;
  subscriberFactory: () => TicketEventSubscriber;
  webhookSecret: string;
  repos: {
    orgs: OrgsRepo;
    auth: AuthRepo;
    articles: ArticlesRepo;
    tickets: TicketsRepo;
    webhooks: WebhooksRepo;
  };
}

export async function buildContext(env: Env): Promise<AppContext> {
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const qdrant = createQdrant(env.QDRANT_URL, env.QDRANT_API_KEY);
  const ai = await wireAiClients(env);

  const articleStore = new ArticleVectorStore(qdrant, ai.embeddings.dimensions);
  const ticketStore = new TicketVectorStore(qdrant, ai.embeddings.dimensions);
  await Promise.all([articleStore.init(), ticketStore.init()]);

  const tokens = new TokenService(
    env.JWT_ACCESS_SECRET,
    env.JWT_REFRESH_SECRET,
    env.JWT_ACCESS_TTL_SECONDS,
    env.JWT_REFRESH_TTL_SECONDS,
  );

  return {
    db,
    redis,
    qdrant,
    embeddings: ai.embeddings,
    llm: ai.llm,
    aiBackend: ai.backend,
    tokens,
    embeddingQueue: createEmbeddingQueue(redis),
    articleStore,
    ticketStore,
    searchCache: new CacheAside(redis, "search"),
    loginLimiter: new TokenBucketRateLimiter(redis, { capacity: 5, refillPerSecond: 5 / 300 }),
    publisher: new TicketEventPublisher(redis),
    subscriberFactory: () => new TicketEventSubscriber(() => createRedis(env.REDIS_URL)),
    webhookSecret: env.INBOUND_WEBHOOK_SECRET,
    repos: {
      orgs: new OrgsRepo(db),
      auth: new AuthRepo(db),
      articles: new ArticlesRepo(db),
      tickets: new TicketsRepo(db),
      webhooks: new WebhooksRepo(db),
    },
  };
}
