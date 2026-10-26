CREATE TABLE notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('text','checklist')),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200 AND title=btrim(title)),
 body text NOT NULL DEFAULT '' CHECK (char_length(body)<=10000),
 items jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items)='array'),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='text' AND items='[]'::jsonb) OR (kind='checklist' AND body='' AND jsonb_array_length(items) BETWEEN 1 AND 100))
);
CREATE INDEX notes_owner_updated_idx ON notes(user_id,updated_at DESC,id);

---- create above / drop below ----

DROP TABLE notes;
