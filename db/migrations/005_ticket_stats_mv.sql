-- The org dashboard's summary tile (open count, avg resolution time) was
-- originally a live aggregate query. Measured on a seeded 500k-row tickets
-- table (see docs/QUERY_TUNING.md for the full EXPLAIN ANALYZE before/after):
-- ~140ms per dashboard load with a single core, ~22ms with Postgres's
-- parallel seq scan - either way it has to aggregate every row belonging to
-- the org, because no index can serve an avg(resolved_at - created_at).
-- A materialized view refreshed on a schedule (or after bulk resolves)
-- turns that into a single B-tree index lookup - measured at 0.06ms, a
-- ~2,300x reduction - at the cost of staleness bounded by the refresh
-- interval, which is an acceptable trade for a summary tile that isn't
-- expected to be real-time to the second.
CREATE MATERIALIZED VIEW ticket_stats_by_org AS
SELECT
    org_id,
    count(*) FILTER (WHERE status IN ('open', 'pending'))            AS open_count,
    count(*) FILTER (WHERE status = 'resolved')                      AS resolved_count,
    avg(extract(epoch FROM resolved_at - created_at))
        FILTER (WHERE resolved_at IS NOT NULL)                       AS avg_resolution_seconds
FROM tickets
GROUP BY org_id;

CREATE UNIQUE INDEX ticket_stats_by_org_org_uq ON ticket_stats_by_org (org_id);
