-- Knowledge-base articles. Semantic search lives in Qdrant (qdrant_point_id
-- links a row to its vector); full-text search stays in Postgres as a fast,
-- zero-extra-infra fallback and for exact keyword/tag queries the embedding
-- model would blur (error codes, SKUs, exact phrases).
CREATE TABLE articles (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    title           text NOT NULL,
    body            text NOT NULL,
    tags            text[] NOT NULL DEFAULT '{}',
    qdrant_point_id uuid UNIQUE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    search_vector   tsvector GENERATED ALWAYS AS (
                        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(body, '')), 'B')
                    ) STORED
);

CREATE INDEX articles_search_vector_gin ON articles USING GIN (search_vector);
CREATE INDEX articles_tags_gin ON articles USING GIN (tags);
CREATE INDEX articles_org_updated_at ON articles (org_id, updated_at DESC);
