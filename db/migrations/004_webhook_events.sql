-- Idempotency ledger for inbound webhooks (e.g. an email-to-ticket provider
-- retrying a delivery). The unique constraint on provider_event_id is the
-- actual guard; a concurrent duplicate delivery loses the insert race and
-- gets a 23505, which the handler treats as "already processed".
CREATE TABLE webhook_events (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider           text NOT NULL,
    provider_event_id  text NOT NULL,
    payload            jsonb NOT NULL,
    processed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX webhook_events_provider_event_uq ON webhook_events (provider, provider_event_id);
