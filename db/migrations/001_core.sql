-- Core tenancy + auth tables.
CREATE TABLE orgs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('admin', 'agent', 'customer');

CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    email          citext NOT NULL,
    password_hash  text NOT NULL,
    role           user_role NOT NULL DEFAULT 'customer',
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- A user's email only needs to be unique within its own org (multi-tenant),
-- and every auth lookup filters by org_id first, so the unique index doubles
-- as the lookup index (no separate index on org_id alone is needed here).
CREATE UNIQUE INDEX users_org_email_uq ON users (org_id, email);

CREATE TABLE refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  text NOT NULL,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Refresh-token rotation always looks up "the live token for this user",
-- so a partial index that excludes revoked rows keeps that lookup on a
-- small, hot slice of the table even after months of rotations.
CREATE INDEX refresh_tokens_live_by_user
    ON refresh_tokens (user_id, expires_at DESC)
    WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX refresh_tokens_hash_uq ON refresh_tokens (token_hash);
