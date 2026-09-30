import type { Redis } from "ioredis";

// Generic cache-aside helper with a Redis-lock guard against stampedes: if
// N requests miss the same key at once, only the first acquires the lock
// and computes the value; the rest wait briefly and retry the cache instead
// of all N hitting Postgres/Qdrant/the LLM at the same time.
export class CacheAside {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
  ) {}

  private key(k: string) {
    return `${this.namespace}:${k}`;
  }

  async getOrLoad<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cacheKey = this.key(key);
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return JSON.parse(cached) as T;

    const lockKey = `${cacheKey}:lock`;
    const gotLock = await this.redis.set(lockKey, "1", "EX", 10, "NX");

    if (!gotLock) {
      // Someone else is already loading this key. Poll briefly rather than
      // stampede the source of truth.
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((r) => setTimeout(r, 50));
        const retry = await this.redis.get(cacheKey);
        if (retry !== null) return JSON.parse(retry) as T;
      }
      // Lock holder is slow or died; fall through and load ourselves rather
      // than fail the request.
    }

    try {
      const value = await load();
      await this.redis.set(cacheKey, JSON.stringify(value), "EX", ttlSeconds);
      return value;
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }

  // Deletes every cached key under a prefix (e.g. "all cached searches for
  // this org") using SCAN rather than KEYS: KEYS blocks the single-threaded
  // Redis event loop for the full keyspace scan, which on a shared instance
  // stalls every other client's requests for the duration; SCAN walks the
  // keyspace in small cursor-driven batches instead.
  async invalidatePrefix(prefix: string): Promise<number> {
    const pattern = `${this.key(prefix)}*`;
    let cursor = "0";
    let deleted = 0;

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await this.redis.del(...keys);
      }
    } while (cursor !== "0");

    return deleted;
  }
}
