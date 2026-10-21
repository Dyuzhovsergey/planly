-- Write your migrate up statements here

ALTER TABLE users ADD COLUMN username text;

UPDATE users
SET username = 'legacy_' || left(md5(id::text), 24)
WHERE username IS NULL;

ALTER TABLE users
    ALTER COLUMN username SET NOT NULL,
    ADD CONSTRAINT users_username_key UNIQUE (username),
    ADD CONSTRAINT users_username_normalized CHECK (
        username = lower(btrim(username))
        AND username ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$'
    );

---- create above / drop below ----

ALTER TABLE users DROP COLUMN username;
