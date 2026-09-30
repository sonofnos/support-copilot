import type { Redis } from "ioredis";

// Token-bucket rate limiter implemented as a single Lua script so the
// read-modify-write (check tokens, refill, decrement) is atomic on the
// Redis server - a plain GET/SET pair from Node would race under
// concurrent requests from the same client and let bursts through.
//
// KEYS[1]  = bucket key
// ARGV[1]  = capacity (max tokens)
// ARGV[2]  = refill rate (tokens per second)
// ARGV[3]  = now (ms, from the app so tests can control it)
// ARGV[4]  = cost (tokens this request consumes)
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'updated_at_ms')
local tokens = tonumber(bucket[1])
local updated_at_ms = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  updated_at_ms = now_ms
end

local elapsed_seconds = math.max(0, now_ms - updated_at_ms) / 1000
tokens = math.min(capacity, tokens + elapsed_seconds * refill_rate)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'updated_at_ms', now_ms)
-- Bucket is idle-expired well past its natural refill time so a client
-- that stops making requests doesn't leave a key around forever.
redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)

return { allowed, tokens }
`;

export interface RateLimitResult {
  allowed: boolean;
  remainingTokens: number;
}

export class TokenBucketRateLimiter {
  private readonly redis: Redis;
  private readonly capacity: number;
  private readonly refillPerSecond: number;

  constructor(redis: Redis, opts: { capacity: number; refillPerSecond: number }) {
    this.redis = redis;
    this.capacity = opts.capacity;
    this.refillPerSecond = opts.refillPerSecond;
  }

  async consume(bucketKey: string, cost = 1, now = Date.now()): Promise<RateLimitResult> {
    const [allowed, remaining] = (await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      bucketKey,
      this.capacity,
      this.refillPerSecond,
      now,
      cost,
    )) as [number, string];

    return { allowed: allowed === 1, remainingTokens: Number(remaining) };
  }
}
