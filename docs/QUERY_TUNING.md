# Query tuning: the org dashboard stats tile

This documents one real, measured optimization in this codebase: `ticket_stats_by_org`
(migration [`005_ticket_stats_mv.sql`](../db/migrations/005_ticket_stats_mv.sql)), queried
from [`TicketsRepo.statsForOrg`](../src/modules/tickets/ticketsRepo.ts) and served at
`GET /tickets/stats`.

## The problem

The org dashboard's summary tile needs three numbers per org: how many tickets are
currently open/pending, how many are resolved, and the average time-to-resolution. The
obvious first implementation is a live aggregate:

```sql
SELECT
    count(*) FILTER (WHERE status IN ('open','pending')) AS open_count,
    count(*) FILTER (WHERE status = 'resolved')          AS resolved_count,
    avg(extract(epoch FROM resolved_at - created_at))
        FILTER (WHERE resolved_at IS NOT NULL)            AS avg_resolution_seconds
FROM tickets
WHERE org_id = $1;
```

This has no index to lean on: it has to touch every row belonging to the org to compute
the average, so it's an unavoidable sequential scan over that org's slice of the table
(`tickets_org_open_queue`, the partial index this project uses everywhere else in the
tickets module, only covers `open`/`pending` rows - it can't serve an aggregate that also
needs `resolved` rows for the resolution-time average).

## Measuring it

Seeded 500,000 synthetic tickets across 20 orgs (`scripts/seed_bench.sql`, run once
directly with `psql`, not part of the app's normal seed path) and ran `EXPLAIN (ANALYZE,
BUFFERS)` against a real `postgres:16-alpine` container on this machine (Apple M-series,
NVMe, warm OS page cache - i.e. a *best case* for the seq scan; a busier/colder production
instance would look worse, not better):

**Live aggregate, Postgres's parallel workers disabled** (`SET
max_parallel_workers_per_gather = 0`, to see the true single-core cost rather than let
extra CPU cores flatter the seq scan):

```
Aggregate  (actual time=139.584..139.585 rows=1 loops=1)
  Buffers: shared hit=8454
  ->  Seq Scan on tickets  (actual time=0.014..132.628 rows=25000 loops=1)
        Filter: (org_id = $1)
        Rows Removed by Filter: 475000
Execution Time: 139.724 ms
```

**With Postgres's parallel seq scan allowed** (the default - two workers picked this
query up automatically): 22.482 ms. Still a full-table-slice scan, just spread across
cores.

**Materialized view lookup**, after `REFRESH MATERIALIZED VIEW CONCURRENTLY
ticket_stats_by_org`:

```
Index Scan using ticket_stats_by_org_org_uq on ticket_stats_by_org
  (actual time=0.013..0.014 rows=1 loops=1)
  Index Cond: (org_id = $1)
  Buffers: shared hit=2
Execution Time: 0.061 ms
```

**0.061 ms vs 139.724 ms - roughly a 2,290x reduction**, and the gap widens as the table
grows: the live query's cost scales with the org's ticket volume; the materialized view's
cost is a single B-tree lookup regardless of table size.

## The trade-off, stated plainly

A materialized view is stale between refreshes. This is deliberately the right trade for
a dashboard summary tile - nobody needs the open-ticket count to update within the same
second a ticket closes - but it would be the *wrong* choice for, say, the ticket detail
page itself, which reads the live `tickets`/`ticket_messages` rows directly. Staleness
bound = however often `REFRESH MATERIALIZED VIEW CONCURRENTLY ticket_stats_by_org` runs
(a cron job or a hook after bulk status changes; not wired up as a running scheduler in
this repo, since that's an ops decision - the query-plan evidence is the point here, not a
scheduler). `CONCURRENTLY` matters operationally too: a plain `REFRESH` takes an exclusive
lock and blocks reads of the view for its duration; `CONCURRENTLY` (which requires the
unique index this migration also creates) refreshes into a shadow copy and swaps it in,
so `GET /tickets/stats` is never blocked by a refresh in progress.

## Reproducing this

```bash
docker compose up -d postgres
npm run migrate
PGPASSWORD=support psql -h localhost -p 5436 -U support -d support_copilot -f scripts/seed_bench.sql
# then run the EXPLAIN ANALYZE queries above directly with psql
```
