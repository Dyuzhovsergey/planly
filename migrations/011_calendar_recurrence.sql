-- Extend allowed frequencies without rewriting existing series or exceptions.
ALTER TABLE recurrence_series DROP CONSTRAINT recurrence_series_check;
ALTER TABLE recurrence_series ADD CONSTRAINT recurrence_series_check CHECK ((jsonb_typeof(definition)='object'
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
  AND definition->'recurrence'->>'frequency' IN ('daily','weekly','monthly','yearly')
  AND jsonb_typeof(definition->'recurrence'->'interval')='number'
  AND definition->'recurrence'->>'interval' ~ '^[1-9][0-9]*$'
  AND definition->'recurrence'->'interval' BETWEEN '1'::jsonb AND '365'::jsonb
  AND jsonb_typeof(definition->'recurrence'->'end')='object'
  AND definition->'recurrence'->'end'->>'type' IN ('never','until','count')) IS TRUE);
---- create above / drop below ----

-- Downgrade fails safely if monthly/yearly series exist; never delete user data.
ALTER TABLE recurrence_series DROP CONSTRAINT recurrence_series_check;
ALTER TABLE recurrence_series ADD CONSTRAINT recurrence_series_check CHECK ((jsonb_typeof(definition)='object'
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
  AND definition->'recurrence'->'end'->>'type' IN ('never','until','count')) IS TRUE);
