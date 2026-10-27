CREATE TABLE birthdays (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    month integer NOT NULL,
    day integer NOT NULL,
    birth_year integer,
    note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT birthdays_name_normalized CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT birthdays_note_length CHECK (char_length(note) <= 10000),
    CONSTRAINT birthdays_year_range CHECK (birth_year IS NULL OR birth_year BETWEEN 1 AND 9999),
    -- Unknown years use a leap-year reference solely for month/day validity.
    CONSTRAINT birthdays_valid_date CHECK (
        month BETWEEN 1 AND 12 AND day BETWEEN 1 AND
        CASE month
            WHEN 2 THEN CASE WHEN COALESCE(birth_year,2000) % 400 = 0 OR
                (COALESCE(birth_year,2000) % 4 = 0 AND COALESCE(birth_year,2000) % 100 <> 0)
                THEN 29 ELSE 28 END
            WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
            ELSE 31
        END
    )
);

CREATE INDEX birthdays_user_month_day_id_idx ON birthdays (user_id, month, day, id);

---- create above / drop below ----

DROP TABLE birthdays;
