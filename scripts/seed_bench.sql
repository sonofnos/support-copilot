-- One-off dataset for docs/QUERY_TUNING.md's EXPLAIN ANALYZE comparison.
-- Not part of the app's normal seed path (see scripts/seed.ts for that) -
-- run this directly with psql against a disposable database.
INSERT INTO orgs (id, name)
SELECT gen_random_uuid(), 'Bench Org ' || i
FROM generate_series(1, 20) AS i;

INSERT INTO users (org_id, email, password_hash, role)
SELECT o.id, 'customer' || gs || '@bench.test', 'x', 'customer'
FROM orgs o
CROSS JOIN generate_series(1, 5) AS gs
WHERE o.name LIKE 'Bench Org%';

-- 20 orgs * 5 users * 5000 tickets = 500,000 rows, matching the volume
-- measured in docs/QUERY_TUNING.md.
INSERT INTO tickets (org_id, customer_id, subject, status, priority, created_at, updated_at, resolved_at)
SELECT
    u.org_id,
    u.id,
    'Synthetic ticket ' || gs,
    (ARRAY['open', 'pending', 'resolved', 'closed']::ticket_status[])[1 + floor(random() * 4)::int],
    (ARRAY['low', 'normal', 'high', 'urgent']::ticket_priority[])[1 + floor(random() * 4)::int],
    created,
    created,
    CASE WHEN random() < 0.6 THEN created + (random() * interval '5 days') ELSE NULL END
FROM (
    SELECT u.id, u.org_id, gs, now() - (random() * interval '365 days') AS created
    FROM users u
    JOIN orgs o ON o.id = u.org_id AND o.name LIKE 'Bench Org%'
    CROSS JOIN generate_series(1, 5000) AS gs
) AS u;

REFRESH MATERIALIZED VIEW ticket_stats_by_org;
VACUUM ANALYZE tickets;
