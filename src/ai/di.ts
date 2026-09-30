import type { Env } from "../config/env.js";
import type { EmbeddingClient } from "./embeddings/EmbeddingClient.js";
import { FakeEmbeddingClient } from "./embeddings/FakeEmbeddingClient.js";
import { OllamaEmbeddingClient } from "./embeddings/OllamaEmbeddingClient.js";
import { OpenAiCompatibleEmbeddingClient } from "./embeddings/OpenAiCompatibleEmbeddingClient.js";
import type { LlmClient } from "./llm/LlmClient.js";
import { FakeLlmClient } from "./llm/FakeLlmClient.js";
import { OllamaLlmClient } from "./llm/OllamaLlmClient.js";
import { OpenAiCompatibleLlmClient } from "./llm/OpenAiCompatibleLlmClient.js";

async function isReachable(url: string, timeoutMs = 500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export interface AiClients {
  embeddings: EmbeddingClient;
  llm: LlmClient;
  backend: "ollama" | "hosted-api" | "fake";
}

// Preference order and why: local Ollama first (free, private, no egress -
// the right default for a self-hosted support desk handling customer PII),
// then a hosted OpenAI-compatible API if one is configured (better quality,
// used when Ollama isn't running), then a deterministic fake so the app,
// its tests, and CI never hard-fail just because no model is available.
// This mirrors the pattern used in this repo's sibling project
// agent-platform's FakeLlmClient/FakeEmbeddingClient DI.
export async function wireAiClients(env: Env): Promise<AiClients> {
  if (env.OLLAMA_BASE_URL && (await isReachable(`${env.OLLAMA_BASE_URL}/api/tags`))) {
    return {
      backend: "ollama",
      embeddings: new OllamaEmbeddingClient(
        env.OLLAMA_BASE_URL,
        env.OLLAMA_EMBEDDING_MODEL,
        env.AI_EMBEDDING_DIMENSIONS,
      ),
      llm: new OllamaLlmClient(env.OLLAMA_BASE_URL, env.OLLAMA_CHAT_MODEL),
    };
  }

  if (env.AI_API_BASE_URL && env.AI_API_KEY) {
    return {
      backend: "hosted-api",
      embeddings: new OpenAiCompatibleEmbeddingClient(
        env.AI_API_BASE_URL,
        env.AI_API_KEY,
        env.AI_EMBEDDING_MODEL,
        env.AI_EMBEDDING_DIMENSIONS,
      ),
      llm: new OpenAiCompatibleLlmClient(env.AI_API_BASE_URL, env.AI_API_KEY, env.AI_CHAT_MODEL),
    };
  }

  return {
    backend: "fake",
    embeddings: new FakeEmbeddingClient(env.AI_EMBEDDING_DIMENSIONS),
    llm: new FakeLlmClient(),
  };
}
