import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { EmbeddingClient } from "../../ai/embeddings/EmbeddingClient.js";
import type { CacheAside } from "../../redis/cache.js";
import type { ArticleVectorStore } from "../../qdrant/articlesCollection.js";
import type { Queue } from "bullmq";
import type { EmbedJobData } from "../../queue/embeddingQueue.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import type { ArticlesRepo } from "./articlesRepo.js";

const createSchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

const searchSchema = z.object({
  q: z.string().min(2),
  limit: z.coerce.number().min(1).max(20).default(5),
});

export function buildArticlesRouter(deps: {
  repo: ArticlesRepo;
  embeddings: EmbeddingClient;
  articleStore: ArticleVectorStore;
  embeddingQueue: Queue<EmbedJobData>;
  searchCache: CacheAside;
}) {
  const router = Router();
  const { repo, embeddings, articleStore, embeddingQueue, searchCache } = deps;

  router.post("/", validateBody(createSchema), async (req, res) => {
    const orgId = req.auth!.orgId;
    const { title, body, tags } = req.body as z.infer<typeof createSchema>;

    const article = await repo.create({ orgId, title, body, tags });
    await embeddingQueue.add("embed-article", {
      kind: "article",
      id: article.id,
      orgId,
      text: `${title}\n\n${body}`,
    });

    res.status(201).json(article);
  });

  // Registered before "/:id" - Express matches routes in registration
  // order, and "/:id" would otherwise swallow "/search" as if "search"
  // were an id (and fail a UUID cast in Postgres).
  //
  // Semantic search is the expensive path (an embedding call plus a Qdrant
  // HNSW search), and support-desk queries are highly repetitive ("reset
  // password", "refund policy"...), so identical (org, query) pairs are
  // cached for a short TTL. The cache key hashes the query text so it
  // doesn't leak raw customer input into Redis key names/logs.
  router.get("/search", validateQuery(searchSchema), async (req, res) => {
    const orgId = req.auth!.orgId;
    const { q, limit } = res.locals.query as z.infer<typeof searchSchema>;
    const cacheKey = `${orgId}:${createHash("sha256").update(q).digest("hex")}:${limit}`;

    const articleIds = await searchCache.getOrLoad(cacheKey, 60, async () => {
      const vector = await embeddings.embed(q);
      const hits = await articleStore.search(orgId, vector, limit);
      return hits.map((h) => h.articleId);
    });

    const articles = await repo.findManyByIds(orgId, articleIds);
    // Preserve Qdrant's relevance ordering; a plain `IN (...)` query does not.
    const byId = new Map(articles.map((a) => [a.id, a]));
    res.json(articleIds.map((id) => byId.get(id)).filter(Boolean));
  });

  router.get("/:id", async (req, res) => {
    const article = await repo.findById(req.auth!.orgId, req.params.id!);
    if (!article) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(article);
  });

  router.put("/:id", validateBody(createSchema.partial()), async (req, res) => {
    const orgId = req.auth!.orgId;
    const updated = await repo.update(orgId, req.params.id!, req.body);
    if (!updated) {
      res.status(404).json({ error: "not found" });
      return;
    }

    await embeddingQueue.add("embed-article", {
      kind: "article",
      id: updated.id,
      orgId,
      text: `${updated.title}\n\n${updated.body}`,
    });
    await searchCache.invalidatePrefix(`${orgId}:`); // any cached search for this org may now be stale

    res.json(updated);
  });

  return router;
}
