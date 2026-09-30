import { Redis } from "ioredis";

export function createRedis(url: string): Redis {
  return new Redis(url, {
    // A worker/queue connection that silently stops retrying looks like a
    // hang, not a crash - fail loudly instead of retrying forever with no
    // visibility.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
