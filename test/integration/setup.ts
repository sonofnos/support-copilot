import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { Express } from "express";
import { buildContext, type AppContext } from "../../src/context.js";
import { buildApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "..", "db", "migrations");

async function runMigrations(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      await client.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  } finally {
    await client.end();
  }
}

export interface TestStack {
  app: Express;
  ctx: AppContext;
  env: Env;
  teardown: () => Promise<void>;
}

// Real Postgres, Redis, and Qdrant containers - not mocks - so the tests
// exercise the actual SQL (unique constraints, partial indexes, generated
// columns), Lua rate-limit script, and Qdrant HNSW filtering this project's
// README claims as evidence, the same pattern used across this portfolio's
// other Testcontainers-based repos.
export async function startTestStack(): Promise<TestStack> {
  const [postgres, redis, qdrant] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine").start(),
    new RedisContainer("redis:7-alpine").start(),
    new GenericContainer("qdrant/qdrant:v1.19.0").withExposedPorts(6333).start(),
  ]);

  await runMigrations(postgres.getConnectionUri());

  const env: Env = {
    NODE_ENV: "test",
    PORT: 0,
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: `redis://${redis.getHost()}:${redis.getPort()}`,
    QDRANT_URL: `http://${qdrant.getHost()}:${qdrant.getMappedPort(6333)}`,
    QDRANT_API_KEY: undefined,
    JWT_ACCESS_SECRET: "test-access-secret-0123456789",
    JWT_REFRESH_SECRET: "test-refresh-secret-0123456789",
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 1_209_600,
    // Deliberately no OLLAMA_BASE_URL / AI_API_BASE_URL: forces the DI
    // fallback chain in src/ai/di.ts all the way to the deterministic fake
    // clients, so these tests are hermetic and free regardless of whether
    // this machine has Ollama running.
    OLLAMA_BASE_URL: undefined,
    OLLAMA_EMBEDDING_MODEL: "nomic-embed-text",
    OLLAMA_CHAT_MODEL: "llama3.2:1b",
    AI_API_BASE_URL: undefined,
    AI_API_KEY: undefined,
    AI_CHAT_MODEL: "gpt-4o-mini",
    // 32 buckets is small enough that FakeEmbeddingClient's feature hashing
    // (see src/ai/embeddings/FakeEmbeddingClient.ts) collides often, making
    // semantic-search-ranking assertions flaky; 512 gives the fake client
    // enough room that distinct tokens land in distinct buckets in practice.
    AI_EMBEDDING_DIMENSIONS: 512,
    AI_EMBEDDING_MODEL: "text-embedding-3-small",
    INBOUND_WEBHOOK_SECRET: "test-webhook-secret",
  };

  const ctx = await buildContext(env);
  const app = buildApp(ctx);

  const teardown = async () => {
    await ctx.embeddingQueue.close();
    await ctx.db.destroy();
    await ctx.redis.quit();
    await Promise.all([postgres.stop(), redis.stop(), (qdrant as StartedTestContainer).stop()]);
  };

  return { app, ctx, env, teardown };
}

export type { StartedPostgreSqlContainer, StartedRedisContainer };
