package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/oauth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OAuthRepository persists hashed credentials; grant row locks serialize all uses with revocation.
type OAuthRepository struct{ pool *pgxpool.Pool }

func NewOAuthRepository(p *pgxpool.Pool) *OAuthRepository { return &OAuthRepository{p} }

var _ oauth.Repository = (*OAuthRepository)(nil)

const requestColumns = `id,user_id,client_id,redirect_uri,state,scope,code_challenge,expires_at`

func scanOAuthRequest(row rowScanner) (oauth.Request, error) {
	var r oauth.Request
	e := row.Scan(&r.ID, &r.Owner, &r.ClientID, &r.RedirectURI, &r.State, &r.Scope, &r.Challenge, &r.ExpiresAt)
	if errors.Is(e, pgx.ErrNoRows) {
		e = oauth.ErrNotFound
	}
	return r, e
}
func (r *OAuthRepository) CreateRequest(ctx context.Context, v oauth.Request) (oauth.Request, error) {
	return scanOAuthRequest(r.pool.QueryRow(ctx, `INSERT INTO oauth_authorization_requests(user_id,client_id,redirect_uri,state,scope,code_challenge,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING `+requestColumns, v.Owner, v.ClientID, v.RedirectURI, v.State, v.Scope, v.Challenge, v.ExpiresAt))
}
func (r *OAuthRepository) GetRequest(ctx context.Context, owner, id string, now time.Time) (oauth.Request, error) {
	return scanOAuthRequest(r.pool.QueryRow(ctx, `SELECT `+requestColumns+` FROM oauth_authorization_requests WHERE user_id=$1 AND id::text=$2 AND expires_at>$3`, owner, id, now))
}
func (r *OAuthRepository) Decide(ctx context.Context, owner, id string, allow bool, hash string, now time.Time) (oauth.Request, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return oauth.Request{}, e
	}
	defer tx.Rollback(ctx)
	v, e := scanOAuthRequest(tx.QueryRow(ctx, `SELECT `+requestColumns+` FROM oauth_authorization_requests WHERE user_id=$1 AND id::text=$2 AND expires_at>$3 FOR UPDATE`, owner, id, now))
	if e != nil {
		return v, e
	}
	var decided bool
	if e = tx.QueryRow(ctx, `SELECT decided FROM oauth_authorization_requests WHERE id=$1`, v.ID).Scan(&decided); e != nil {
		return v, e
	}
	if decided {
		return v, oauth.ErrConflict
	}
	if _, e = tx.Exec(ctx, `UPDATE oauth_authorization_requests SET decided=true WHERE id=$1`, v.ID); e != nil {
		return v, e
	}
	if allow {
		var grant string
		e = tx.QueryRow(ctx, `INSERT INTO oauth_grants(user_id,client_id,scope,created_at,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id`, owner, v.ClientID, v.Scope, now, now.Add(30*24*time.Hour)).Scan(&grant)
		if e != nil {
			return v, e
		}
		_, e = tx.Exec(ctx, `INSERT INTO oauth_credentials(token_hash,grant_id,kind,expires_at,redirect_uri,code_challenge) VALUES($1,$2,'code',$3,$4,$5)`, hash, grant, now.Add(120*time.Second), v.RedirectURI, v.Challenge)
		if e != nil {
			return v, e
		}
	}
	return v, tx.Commit(ctx)
}
func (r *OAuthRepository) Exchange(ctx context.Context, client, hash, redirect, challenge string, i oauth.Issue) (time.Time, error) {
	return r.issue(ctx, client, hash, "code", redirect, challenge, i)
}
func (r *OAuthRepository) Refresh(ctx context.Context, client, hash string, i oauth.Issue) (time.Time, error) {
	return r.issue(ctx, client, hash, "refresh", "", "", i)
}
func (r *OAuthRepository) issue(ctx context.Context, client, hash, kind, redirect, challenge string, i oauth.Issue) (time.Time, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return time.Time{}, e
	}
	defer tx.Rollback(ctx)
	var grant string
	var until time.Time
	e = tx.QueryRow(ctx, `SELECT g.id,g.expires_at FROM oauth_grants g JOIN oauth_credentials c ON c.grant_id=g.id WHERE c.token_hash=$1 AND c.kind=$2 AND g.client_id=$3 AND NOT g.revoked AND g.scope=$4 AND g.expires_at>($5::timestamptz+interval '1 second') AND c.expires_at>$5 AND NOT c.used FOR UPDATE OF g`, hash, kind, client, oauth.Scope, i.Now).Scan(&grant, &until)
	if errors.Is(e, pgx.ErrNoRows) {
		return until, oauth.ErrGrant
	}
	if e != nil {
		return until, e
	}
	// Lock the code after the grant: concurrent exchanges must observe the first consumption.
	if kind == "code" {
		var used bool
		var storedRedirect, storedChallenge string
		e = tx.QueryRow(ctx, `SELECT used,redirect_uri,code_challenge FROM oauth_credentials WHERE token_hash=$1 FOR UPDATE`, hash).Scan(&used, &storedRedirect, &storedChallenge)
		if e != nil {
			return until, e
		}
		if used || redirect != storedRedirect || challenge != storedChallenge {
			return until, oauth.ErrGrant
		}
		if _, e = tx.Exec(ctx, `UPDATE oauth_credentials SET used=true WHERE token_hash=$1`, hash); e != nil {
			return until, e
		}
	}
	accessUntil := i.AccessUntil
	if until.Before(accessUntil) {
		accessUntil = until
	}
	if _, e = tx.Exec(ctx, `INSERT INTO oauth_credentials(token_hash,grant_id,kind,expires_at) VALUES($1,$2,'access',$3)`, i.AccessHash, grant, accessUntil); e != nil {
		return until, e
	}
	if kind == "code" {
		if _, e = tx.Exec(ctx, `INSERT INTO oauth_credentials(token_hash,grant_id,kind,expires_at) VALUES($1,$2,'refresh',$3)`, i.RefreshHash, grant, until); e != nil {
			return until, e
		}
	}
	return until, tx.Commit(ctx)
}
func (r *OAuthRepository) List(ctx context.Context, owner, client string, now time.Time) ([]oauth.Grant, error) {
	rows, e := r.pool.Query(ctx, `SELECT id,scope,created_at,expires_at FROM oauth_grants WHERE user_id=$1 AND client_id=$2 AND NOT revoked AND expires_at>$3 ORDER BY created_at DESC,id`, owner, client, now)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []oauth.Grant{}
	for rows.Next() {
		var g oauth.Grant
		g.ClientName = "Алиса · Planly"
		if e = rows.Scan(&g.ID, &g.Scope, &g.CreatedAt, &g.ExpiresAt); e != nil {
			return nil, e
		}
		items = append(items, g)
	}
	return items, rows.Err()
}
func (r *OAuthRepository) Revoke(ctx context.Context, owner, id, client string) error {
	result, e := r.pool.Exec(ctx, `UPDATE oauth_grants SET revoked=true WHERE id::text=$1 AND user_id=$2 AND client_id=$3`, id, owner, client)
	if e == nil && result.RowsAffected() == 0 {
		return oauth.ErrNotFound
	}
	return e
}
func (r *OAuthRepository) RevokeToken(ctx context.Context, client, hash string) error {
	_, e := r.pool.Exec(ctx, `UPDATE oauth_grants SET revoked=true WHERE client_id=$1 AND id IN(SELECT grant_id FROM oauth_credentials WHERE token_hash=$2)`, client, hash)
	return e
}
func (r *OAuthRepository) Verify(ctx context.Context, client, hash, skill, subject string, now time.Time) error {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var id, oldSkill, oldSubject string
	e = tx.QueryRow(ctx, `SELECT g.id,g.skill_id,g.subject_hash FROM oauth_grants g JOIN oauth_credentials c ON c.grant_id=g.id WHERE c.token_hash=$1 AND c.kind='access' AND c.expires_at>$2 AND g.expires_at>$2 AND NOT g.revoked AND g.client_id=$3 AND g.scope=$4 FOR UPDATE OF g`, hash, now, client, oauth.Scope).Scan(&id, &oldSkill, &oldSubject)
	if errors.Is(e, pgx.ErrNoRows) {
		return oauth.ErrGrant
	}
	if e != nil {
		return e
	}
	if oldSkill != "" && (oldSkill != skill || oldSubject != subject) {
		return oauth.ErrGrant
	}
	if oldSkill == "" {
		if _, e = tx.Exec(ctx, `UPDATE oauth_grants SET skill_id=$1,subject_hash=$2 WHERE id=$3`, skill, subject, id); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
