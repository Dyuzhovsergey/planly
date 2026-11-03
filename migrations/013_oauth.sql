CREATE TABLE oauth_authorization_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_id text NOT NULL,
 redirect_uri text NOT NULL,
 state text NOT NULL,
 scope text NOT NULL CHECK(scope='planly:voice:create'),
 code_challenge text NOT NULL DEFAULT '',
 expires_at timestamptz NOT NULL,
 decided boolean NOT NULL DEFAULT false
);
CREATE TABLE oauth_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_id text NOT NULL,
 scope text NOT NULL CHECK(scope='planly:voice:create'),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked boolean NOT NULL DEFAULT false,
 skill_id text NOT NULL DEFAULT '',
 subject_hash text NOT NULL DEFAULT '',
 CHECK(expires_at>created_at)
);
CREATE INDEX oauth_grants_owner ON oauth_grants(user_id);
CREATE TABLE oauth_credentials (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
 grant_id uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('code','access','refresh')),
 expires_at timestamptz NOT NULL,
 redirect_uri text NOT NULL DEFAULT '',
 code_challenge text NOT NULL DEFAULT '',
 used boolean NOT NULL DEFAULT false
);
CREATE INDEX oauth_credentials_grant ON oauth_credentials(grant_id);

---- create above / drop below ----

DROP TABLE oauth_credentials;
DROP TABLE oauth_grants;
DROP TABLE oauth_authorization_requests;
