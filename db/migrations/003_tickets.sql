CREATE TYPE ticket_status AS ENUM ('open', 'pending', 'resolved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');

CREATE TABLE tickets (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    customer_id        uuid NOT NULL REFERENCES users (id),
    assigned_agent_id  uuid REFERENCES users (id),
    subject            text NOT NULL,
    status             ticket_status NOT NULL DEFAULT 'open',
    priority           ticket_priority NOT NULL DEFAULT 'normal',
    qdrant_point_id    uuid UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    resolved_at        timestamptz
);

-- The agent dashboard's single most frequent query is "open/pending tickets
-- for my org, newest first". A partial index on just the live statuses keeps
-- that index small and fast forever, instead of scanning years of closed
-- tickets that the dashboard never asks for.
CREATE INDEX tickets_org_open_queue
    ON tickets (org_id, created_at DESC)
    WHERE status IN ('open', 'pending');

CREATE INDEX tickets_assigned_agent ON tickets (assigned_agent_id) WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX tickets_customer ON tickets (customer_id);

CREATE TABLE ticket_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   uuid NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
    author_id   uuid NOT NULL REFERENCES users (id),
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Thread rendering always does "messages for ticket X in order"; this index
-- makes that an index-only range scan instead of a sort after the fact.
CREATE INDEX ticket_messages_thread ON ticket_messages (ticket_id, created_at);
