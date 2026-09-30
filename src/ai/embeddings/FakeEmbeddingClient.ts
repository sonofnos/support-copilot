import { createHash } from "node:crypto";
import type { EmbeddingClient } from "./EmbeddingClient.js";

// Deterministic feature-hashing "embedding": no model, no network, no API
// key. Semantically meaningless, but stable (same text -> same vector) and
// cheap enough to run in CI/tests so integration tests can exercise the
// real Qdrant upsert/search path without a live Ollama daemon or API key.
export class FakeEmbeddingClient implements EmbeddingClient {
  constructor(readonly dimensions = 768) {}

  async embed(text: string): Promise<number[]> {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);

    for (const token of tokens) {
      const hash = createHash("sha256").update(token).digest();
      const bucket = hash.readUInt32BE(0) % this.dimensions;
      const sign = hash[4]! % 2 === 0 ? 1 : -1;
      vector[bucket] += sign;
    }

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
