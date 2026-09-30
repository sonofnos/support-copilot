import type { EmbeddingClient } from "./EmbeddingClient.js";

// Any OpenAI-compatible /v1/embeddings endpoint - OpenAI itself, Groq,
// or a self-hosted LiteLLM proxy. Used as the hosted fallback when no local
// Ollama daemon is reachable.
export class OpenAiCompatibleEmbeddingClient implements EmbeddingClient {
  readonly dimensions: number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    dimensions: number,
  ) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    if (!vector) throw new Error("No embedding returned");
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) {
      throw new Error(`Embedding API failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
