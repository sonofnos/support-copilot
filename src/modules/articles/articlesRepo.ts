import { sql, type Kysely } from "kysely";
import type { Database } from "../../db/types.js";

export class ArticlesRepo {
  constructor(private readonly db: Kysely<Database>) {}

  create(input: { orgId: string; title: string; body: string; tags: string[] }) {
    return this.db
      .insertInto("articles")
      .values({ org_id: input.orgId, title: input.title, body: input.body, tags: input.tags })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findById(orgId: string, id: string) {
    return this.db
      .selectFrom("articles")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  findManyByIds(orgId: string, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom("articles")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("id", "in", ids)
      .execute();
  }

  setQdrantPointId(id: string, qdrantPointId: string) {
    return this.db.updateTable("articles").set({ qdrant_point_id: qdrantPointId }).where("id", "=", id).execute();
  }

  update(orgId: string, id: string, input: { title?: string; body?: string; tags?: string[] }) {
    return this.db
      .updateTable("articles")
      .set({ ...input, updated_at: new Date() })
      .where("org_id", "=", orgId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  // Keyword/exact-phrase fallback path (see migration 002 comment): ranked
  // by ts_rank so callers get relevance ordering, not just a boolean match.
  fullTextSearch(orgId: string, query: string, limit = 10) {
    const tsquery = sql<string>`plainto_tsquery('english', ${query})`;
    return this.db
      .selectFrom("articles")
      .selectAll()
      .where("org_id", "=", orgId)
      .where(sql<boolean>`search_vector @@ ${tsquery}`)
      .orderBy(sql`ts_rank(search_vector, ${tsquery})`, "desc")
      .limit(limit)
      .execute();
  }
}
