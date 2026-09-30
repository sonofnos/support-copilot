import type { EmbeddingClient } from "./EmbeddingClient.js";

// Talks to a local Ollama daemon (`ollama pull nomic-embed-text`) - no
// egress, no per-token cost, no API key. This is the default embedding
// backend; see ai/di.ts for the fallback chain to a hosted API and then a
// deterministic fake.
export class OllamaEmbeddingClient implements EmbeddingClient {
  readonly dimensions: number;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    dimensions: number,
  ) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!res.ok) {
      throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { embeddings: number[][] };
    const vector = body.embeddings[0];
    if (!vector) throw new Error("Ollama returned no embedding");
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama's /api/embed accepts an array input directly; batching this way
    // is one round trip instead of N.
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) {
      throw new Error(`Ollama batch embed failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { embeddings: number[][] };
    return body.embeddings;
  }
}
