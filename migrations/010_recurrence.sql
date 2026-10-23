CREATE TABLE recurrence_series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('task','event')),
 definition jsonb NOT NULL CHECK ((jsonb_typeof(definition)='object'
  AND definition ?& ARRAY['title','description','location','link','schedule','recurrence']
  AND jsonb_typeof(definition->'title')='string'
  AND char_length(definition->>'title') BETWEEN 1 AND 200
  AND jsonb_typeof(definition->'description')='string' AND (kind='task' OR char_length(definition->>'description')<=10000)
  AND jsonb_typeof(definition->'location')='string' AND char_length(definition->>'location')<=500
  AND jsonb_typeof(definition->'link')='string' AND char_length(definition->>'link')<=2048
  AND (kind='event' OR (definition->>'location'='' AND definition->>'link'=''))
  AND jsonb_typeof(definition->'schedule')='object'
  AND definition->'schedule' ? 'type'
  AND definition->'schedule'->>'type' IN ('timed','allDay')
  AND jsonb_typeof(definition->'recurrence')='object'
  AND definition->'recurrence' ? 'frequency'
  AND definition->'recurrence'->>'frequency' IN ('daily','weekly')
  AND jsonb_typeof(definition->'recurrence'->'interval')='number'
  AND definition->'recurrence'->>'interval' ~ '^[1-9][0-9]*$'
  AND definition->'recurrence'->'interval' BETWEEN '1'::jsonb AND '365'::jsonb
  AND jsonb_typeof(definition->'recurrence'->'end')='object'
  AND definition->'recurrence'->'end'->>'type' IN ('never','until','count')) IS TRUE),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recurrence_series_owner_kind ON recurrence_series(user_id,kind);
CREATE TABLE recurrence_exceptions (
 series_id uuid NOT NULL REFERENCES recurrence_series(id) ON DELETE CASCADE,
 occurrence_date date NOT NULL CHECK (occurrence_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 state jsonb NOT NULL CHECK ((jsonb_typeof(state)='object'
  AND state ?& ARRAY['date','overrides','cancelled','completedAt','snapshot']
  AND state->>'date'=occurrence_date::text
  AND jsonb_typeof(state->'overrides')='object'
  AND jsonb_typeof(state->'cancelled')='boolean'
  AND ((state->'completedAt'='null'::jsonb AND state->'snapshot'='null'::jsonb)
   OR (jsonb_typeof(state->'completedAt')='string' AND jsonb_typeof(state->'snapshot')='object'))) IS TRUE),
 PRIMARY KEY(series_id,occurrence_date)
);
---- create above / drop below ----

DROP TABLE recurrence_exceptions;
DROP TABLE recurrence_series;
