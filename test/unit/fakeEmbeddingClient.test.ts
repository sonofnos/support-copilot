import { describe, expect, it } from "vitest";
import { FakeEmbeddingClient } from "../../src/ai/embeddings/FakeEmbeddingClient.js";

describe("FakeEmbeddingClient", () => {
  it("is deterministic for the same text", async () => {
    const client = new FakeEmbeddingClient(64);
    const a = await client.embed("password reset instructions");
    const b = await client.embed("password reset instructions");
    expect(a).toEqual(b);
  });

  it("produces a unit-norm vector of the configured dimension", async () => {
    const client = new FakeEmbeddingClient(64);
    const vector = await client.embed("refund policy for annual plans");
    expect(vector).toHaveLength(64);
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("places semantically similar text closer than unrelated text (cosine similarity)", async () => {
    const client = new FakeEmbeddingClient(256);
    const cosine = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i]!, 0);

    const a = await client.embed("how do I reset my password");
    const b = await client.embed("password reset instructions needed");
    const c = await client.embed("invoice payment failed for annual subscription");

    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
});
