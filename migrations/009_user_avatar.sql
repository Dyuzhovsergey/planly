ALTER TABLE users
 ADD COLUMN avatar_key text NOT NULL DEFAULT '',
 ADD COLUMN avatar_data bytea,
 ADD CONSTRAINT users_avatar_valid CHECK (
  (avatar_key = '' AND avatar_data IS NULL) OR
  (avatar_key IN ('preset-1','preset-2','preset-3','preset-4','preset-5') AND avatar_data IS NULL) OR
  (avatar_key ~ '^upload-[a-f0-9]{32}$' AND avatar_data IS NOT NULL AND octet_length(avatar_data) BETWEEN 1 AND 2097152)
 );

---- create above / drop below ----

ALTER TABLE users DROP COLUMN avatar_key, DROP COLUMN avatar_data;
