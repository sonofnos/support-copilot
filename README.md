# support-copilot

An AI-assisted customer support desk API: TypeScript/Node/Express, Postgres schema
design and measured query tuning, Qdrant for semantic search, Redis used past
`GET`/`SET` (Lua-scripted rate limiting, cache-aside with stampede protection, pub/sub),
and a local-first AI backend (Ollama) with an OpenAI-compatible hosted fallback and a
deterministic fake for tests/CI.

Built as a focused evidence repo for each of these individually, not a toy that happens
to touch all of them - see the "why" comments throughout the source and the docs below
for the actual reasoning and trade-offs.

## Stack and where to look

| Requirement | Where |
|---|---|
| TypeScript / Node / API design | Whole repo; routes in `src/modules/*/*.routes.ts` |
| Postgres schema design | `db/migrations/*.sql` - multi-tenant FKs, enums, generated columns, partial/GIN/unique indexes |
| Postgres query optimization & tuning | [`docs/QUERY_TUNING.md`](docs/QUERY_TUNING.md) - a real EXPLAIN ANALYZE before/after on 500k seeded rows, ~2,300x |
| Qdrant | `src/qdrant/` - two collections (articles, tickets), org-scoped via payload filters, the 1.10+ Query API |
| Advanced Redis | `src/redis/` - Lua token-bucket rate limiter, cache-aside with a lock against stampedes, SCAN-based invalidation, pub/sub for live ticket events |
| Local AI integration | `src/ai/embeddings/OllamaEmbeddingClient.ts`, `src/ai/llm/OllamaLlmClient.ts` - genuinely runs against a local Ollama daemon, not mocked |
| AI API experience | `src/ai/*/OpenAiCompatible*Client.ts` - any OpenAI-compatible `/v1` endpoint (OpenAI, Groq, a LiteLLM proxy) |
| Auth / security | `src/auth/` - argon2id, rotating opaque refresh tokens, JWT access tokens, RBAC; `src/modules/webhooks/` - constant-time HMAC verification |
| Scalability / data relationships | bounded pg pool, async embedding via BullMQ off the request path, multi-tenant FK design throughout |

## What it does

A multi-tenant support desk: orgs have admins/agents/customers, customers open tickets
and exchange messages with agents, agents search a knowledge base and get "have we seen
this before" suggestions pulled from semantically similar past tickets, and an inbound
webhook can turn a provider event (e.g. an email-to-ticket integration) directly into a
new ticket, idempotently.

## Why local AI first, not an API key

`src/ai/di.ts` wires the embedding and chat clients in this order: **Ollama if a daemon
is reachable → a configured OpenAI-compatible API → a deterministic fake.** A support
desk processes real customer PII in every ticket; defaulting to a model that never leaves
the machine is the right default for that, not just the cheap one. The fake tier exists
so `npm test` and CI never depend on a model being available at all - see
`src/ai/embeddings/FakeEmbeddingClient.ts`, which uses feature hashing so semantically
similar text still lands measurably closer in vector space (`test/unit/fakeEmbeddingClient.test.ts`
asserts this directly) without ever calling a model.

## Running it

```bash
cp .env.example .env
docker compose up -d          # Postgres, Redis, Qdrant
npm install
npm run migrate
npm run seed                  # demo org + admin/agent/customer + articles + a ticket
npm run worker &               # processes the embedding queue
npm run dev
```

`GET /health` reports which AI backend actually got wired up (`ollama` / `hosted-api` /
`fake`) - useful for confirming a local Ollama daemon (`ollama pull nomic-embed-text` and
whatever chat model you set `OLLAMA_CHAT_MODEL` to) was actually picked up.

## Testing

```bash
npm test
```

Integration tests (`test/integration/`) spin up real Postgres, Redis, and Qdrant
containers via Testcontainers - not mocks - and run the actual migrations, HMAC
verification, the Lua rate-limit script, and Qdrant's org-scoped filtering. They force the
AI DI chain down to the deterministic fake client (no `OLLAMA_BASE_URL`/`AI_API_BASE_URL`
set in the test environment) so the suite is hermetic and free regardless of what's
running on the machine it executes on.

## Design notes worth reading

- **Route registration order matters in Express** and this repo hit it for real: `/articles/search`
  and `/tickets/stream/live` both have to be registered before their sibling `/:id` routes,
  or `:id` greedily matches "search"/"stream" as an id and (in the Postgres case) fails a
  UUID cast. See the comments at `src/modules/articles/articlesRoutes.ts` and
  `src/modules/tickets/ticketsRoutes.ts`.
- **Express 4 does not forward a rejected promise from an async handler to error
  middleware on its own** - an unhandled rejection there crashes the process instead of
  producing a 500. `src/app.ts` imports `express-async-errors` specifically to fix this;
  found by an actual crash during development, not by reading the Express docs first.
- **Cache-aside + async indexing has a real race**: caching a semantic search result
  computed before the embedding worker has processed that item caches an empty result for
  the TTL, and every request in that window reads the same stale empty cache entry rather
  than retrying the source of truth. Worth knowing before reaching for cache-aside on
  anything fed by an async pipeline; see the integration tests' comments for how this
  showed up and was worked around in the test suite itself.
- **Qdrant client/server version drift causes flaky-looking failures**, not just a
  logged warning: the `@qdrant/js-client-rest` version in `package.json` and the
  `qdrant/qdrant` image tag in `docker-compose.yml`/`test/integration/setup.ts` are kept
  in the same major.minor for this reason.
- **A cache invalidation bug caught in review before it shipped**: article updates
  originally called `cache.invalidate(orgId)`, but the cache key is
  `orgId:queryHash:limit` - that call would have deleted a key that never existed,
  silently leaving every previously cached search result stale. Fixed with
  `invalidatePrefix` (SCAN-based, not `KEYS`, so it doesn't block Redis's event loop on a
  big keyspace) - see `src/redis/cache.ts`.

## What's honestly not here

No frontend - this is an API-only evidence repo. The materialized view in
`docs/QUERY_TUNING.md` isn't wired to a scheduler (a cron job or a hook after bulk
resolves would own that in a real deployment); the point of that doc is the measured
query-plan evidence, not a scheduling story.
