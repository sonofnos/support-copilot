import type { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4 } from "uuid";
import { ensureCollection } from "./client.js";

export const ARTICLES_COLLECTION = "articles";

export interface ArticlePoint {
  articleId: string;
  orgId: string;
  title: string;
}

export class ArticleVectorStore {
  constructor(
    private readonly qdrant: QdrantClient,
    private readonly vectorSize: number,
  ) {}

  async init(): Promise<void> {
    await ensureCollection(this.qdrant, ARTICLES_COLLECTION, this.vectorSize);
  }

  async upsert(point: ArticlePoint, vector: number[]): Promise<string> {
    const pointId = uuidv4();
    await this.qdrant.upsert(ARTICLES_COLLECTION, {
      wait: true,
      points: [
        {
          id: pointId,
          vector,
          payload: { articleId: point.articleId, orgId: point.orgId, title: point.title },
        },
      ],
    });
    return pointId;
  }

  async delete(pointId: string): Promise<void> {
    await this.qdrant.delete(ARTICLES_COLLECTION, { wait: true, points: [pointId] });
  }

  // Scoped to the caller's org via a payload filter, not a post-filter in
  // app code - Qdrant applies it during the HNSW walk, so a customer in one
  // org can never even be scored against another org's articles regardless
  // of vector similarity.
  async search(orgId: string, vector: number[], limit = 5): Promise<{ articleId: string; score: number }[]> {
    const { points } = await this.qdrant.query(ARTICLES_COLLECTION, {
      query: vector,
      limit,
      filter: { must: [{ key: "orgId", match: { value: orgId } }] },
      with_payload: true,
    });

    return points.map((r) => ({
      articleId: (r.payload as { articleId: string }).articleId,
      score: r.score,
    }));
  }
}
