CREATE TABLE events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    location text NOT NULL DEFAULT '',
    link text NOT NULL DEFAULT '',
    starts_at timestamptz,
    ends_at timestamptz,
    starts_on date,
    ends_on date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT events_title_normalized CHECK (
        title = btrim(title) AND char_length(title) BETWEEN 1 AND 200
    ),
    CONSTRAINT events_text_limits CHECK (
        char_length(description) <= 10000
        AND char_length(location) <= 500
        AND char_length(link) <= 2048
    ),
    -- Explicit null checks avoid SQL UNKNOWN accepting partially specified schedules.
    CONSTRAINT events_exactly_one_interval CHECK (
        (starts_at IS NOT NULL AND ends_at IS NOT NULL
            AND starts_on IS NULL AND ends_on IS NULL
            AND starts_at < ends_at
            AND starts_at >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
            AND ends_at < TIMESTAMPTZ '10000-01-01 00:00:00+00')
        OR
        (starts_at IS NULL AND ends_at IS NULL
            AND starts_on IS NOT NULL AND ends_on IS NOT NULL
            AND starts_on < ends_on
            AND starts_on >= DATE '0001-01-01' AND ends_on <= DATE '9999-12-31')
    )
);

CREATE INDEX events_user_id_id_idx ON events (user_id, id);
CREATE INDEX events_user_starts_at_idx ON events (user_id, starts_at, ends_at)
    WHERE starts_at IS NOT NULL;
CREATE INDEX events_user_starts_on_idx ON events (user_id, starts_on, ends_on)
    WHERE starts_on IS NOT NULL;

---- create above / drop below ----

DROP TABLE events;
