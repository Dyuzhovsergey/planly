ALTER TABLE users
    ADD COLUMN display_name text NOT NULL DEFAULT '',
    ADD COLUMN week_starts_on text NOT NULL DEFAULT 'monday',
    ADD COLUMN time_format text NOT NULL DEFAULT '24h',
    ADD CONSTRAINT users_display_name_valid CHECK (display_name = btrim(display_name) AND char_length(display_name) <= 100),
    ADD CONSTRAINT users_week_starts_on_valid CHECK (week_starts_on IN ('monday','sunday')),
    ADD CONSTRAINT users_time_format_valid CHECK (time_format IN ('12h','24h'));

---- create above / drop below ----

ALTER TABLE users DROP COLUMN display_name, DROP COLUMN week_starts_on, DROP COLUMN time_format;
