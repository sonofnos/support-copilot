import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  QDRANT_URL: z.string().min(1),
  QDRANT_API_KEY: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(1_209_600),

  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  OLLAMA_CHAT_MODEL: z.string().default("llama3.1"),

  AI_API_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  AI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  AI_EMBEDDING_DIMENSIONS: z.coerce.number().default(768),

  INBOUND_WEBHOOK_SECRET: z.string().min(8),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
