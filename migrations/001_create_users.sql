CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    time_zone text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND email <> ''),
    CONSTRAINT users_password_hash_not_empty CHECK (password_hash <> ''),
    CONSTRAINT users_time_zone_not_empty CHECK (time_zone <> '')
);

---- create above / drop below ----

DROP TABLE users;
