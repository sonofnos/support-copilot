import { QdrantClient } from "@qdrant/js-client-rest";

export function createQdrant(url: string, apiKey?: string): QdrantClient {
  return new QdrantClient({ url, apiKey: apiKey || undefined });
}

export async function ensureCollection(
  client: QdrantClient,
  name: string,
  vectorSize: number,
): Promise<void> {
  const { collections } = await client.getCollections();
  if (collections.some((c) => c.name === name)) return;

  await client.createCollection(name, {
    vectors: { size: vectorSize, distance: "Cosine" },
    // HNSW parameters tuned for a knowledge-base-scale collection (tens of
    // thousands of points, not billions): m=16/ef_construct=128 is the
    // standard "good recall, reasonable build time" starting point; on_disk
    // keeps the payload off heap so the collection can grow without
    // resizing the qdrant container's memory limit.
    hnsw_config: { m: 16, ef_construct: 128 },
    on_disk_payload: true,
  });
}
