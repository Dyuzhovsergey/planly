CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    scheduled_at timestamptz,
    scheduled_date date,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tasks_title_normalized CHECK (
        title = btrim(title)
        AND char_length(title) BETWEEN 1 AND 200
    ),
    CONSTRAINT tasks_exactly_one_schedule CHECK (
        num_nonnulls(scheduled_at, scheduled_date) = 1
    )
);

CREATE INDEX tasks_user_id_id_idx ON tasks (user_id, id);

---- create above / drop below ----

DROP TABLE tasks;
