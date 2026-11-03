// Package oauth implements explicit consent and revocable Alice account linking.
package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/url"
	"regexp"
	"time"
)

// Scope is the sole permission reserved for future voice creation.
const Scope = "planly:voice:create"

// RedirectURI is the exact callback registered by Yandex Dialogs.
const RedirectURI = "https://social.yandex.net/broker/redirect"

var ErrInvalid = errors.New("invalid_request")
var ErrNotFound = errors.New("not_found")
var ErrConflict = errors.New("already_decided")
var ErrGrant = errors.New("invalid_grant")

// Config registers exactly one confidential client; only its secret hash is stored.
type Config struct{ ClientID, SecretHash, SkillID string }

// Request binds validated OAuth parameters to the signed-in Planly account.
type Request struct {
	ID          string    `json:"id"`
	Owner       string    `json:"-"`
	ClientID    string    `json:"-"`
	RedirectURI string    `json:"-"`
	State       string    `json:"-"`
	Scope       string    `json:"scope"`
	Challenge   string    `json:"-"`
	ExpiresAt   time.Time `json:"expiresAt"`
	ClientName  string    `json:"clientName"`
}

// Input contains the authorization parameters supplied by the OAuth client.
type Input struct {
	ClientID            string `json:"clientId"`
	RedirectURI         string `json:"redirectUri"`
	ResponseType        string `json:"responseType"`
	State               string `json:"state"`
	Scope               string `json:"scope"`
	CodeChallenge       string `json:"codeChallenge,omitempty"`
	CodeChallengeMethod string `json:"codeChallengeMethod,omitempty"`
}

// Grant is the safe representation shown in account settings.
type Grant struct {
	ID         string    `json:"id"`
	ClientName string    `json:"clientName"`
	Scope      string    `json:"scope"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

// Tokens are returned only once to the authenticated confidential client.
type Tokens struct {
	Access  string `json:"access_token"`
	Type    string `json:"token_type"`
	Expires int    `json:"expires_in"`
	Refresh string `json:"refresh_token,omitempty"`
	Scope   string `json:"scope"`
}

// Issue contains hashed credentials for an atomic token transaction.
type Issue struct {
	AccessHash, RefreshHash string
	Now, AccessUntil        time.Time
}

// Repository serializes code consumption, refresh, binding and revocation with grant locks.
type Repository interface {
	CreateRequest(context.Context, Request) (Request, error)
	GetRequest(context.Context, string, string, time.Time) (Request, error)
	Decide(context.Context, string, string, bool, string, time.Time) (Request, error)
	Exchange(context.Context, string, string, string, string, Issue) (time.Time, error)
	Refresh(context.Context, string, string, Issue) (time.Time, error)
	List(context.Context, string, string, time.Time) ([]Grant, error)
	Revoke(context.Context, string, string, string) error
	RevokeToken(context.Context, string, string) error
	Verify(context.Context, string, string, string, string, time.Time) error
}

// Service applies OAuth policy independently of HTTP and storage.
type Service struct {
	repo   Repository
	Config Config
	now    func() time.Time
}

// NewService assembles account-linking policy with persistent storage.
func NewService(repo Repository, c Config) *Service {
	return &Service{repo: repo, Config: c, now: time.Now}
}

// Hash produces the persisted digest of a high-entropy credential.
func Hash(value string) string { h := sha256.Sum256([]byte(value)); return hex.EncodeToString(h[:]) }
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

var verifierPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

// Authenticate verifies the configured confidential client without exposing its secret.
func (s *Service) Authenticate(id, secret string) bool {
	return s.Config.ClientID != "" && id == s.Config.ClientID && subtle.ConstantTimeCompare([]byte(Hash(secret)), []byte(s.Config.SecretHash)) == 1
}

// Create validates the callback and binds consent parameters to the current owner.
func (s *Service) Create(ctx context.Context, owner string, i Input) (Request, error) {
	if s.Config.ClientID == "" || i.ClientID != s.Config.ClientID || i.RedirectURI != RedirectURI || i.ResponseType != "code" || i.Scope != Scope || len(i.State) == 0 || len(i.State) > 2048 {
		return Request{}, ErrInvalid
	}
	if i.CodeChallenge != "" {
		b, e := base64.RawURLEncoding.DecodeString(i.CodeChallenge)
		if e != nil || len(b) != 32 || base64.RawURLEncoding.EncodeToString(b) != i.CodeChallenge || i.CodeChallengeMethod != "S256" {
			return Request{}, ErrInvalid
		}
	} else if i.CodeChallengeMethod != "" {
		return Request{}, ErrInvalid
	}
	r, e := s.repo.CreateRequest(ctx, Request{Owner: owner, ClientID: i.ClientID, RedirectURI: i.RedirectURI, State: i.State, Scope: i.Scope, Challenge: i.CodeChallenge, ExpiresAt: s.now().UTC().Add(10 * time.Minute)})
	r.ClientName = "Алиса · Planly"
	return r, e
}

// Get returns only the current owner's unexpired authorization request.
func (s *Service) Get(ctx context.Context, owner, id string) (Request, error) {
	r, e := s.repo.GetRequest(ctx, owner, id, s.now())
	if e == nil && r.ClientID != s.Config.ClientID {
		return Request{}, ErrNotFound
	}
	r.ClientName = "Алиса · Planly"
	return r, e
}

// Decide records an explicit choice and constructs a validated broker redirect.
func (s *Service) Decide(ctx context.Context, owner, id, decision string) (string, error) {
	if decision != "allow" && decision != "deny" {
		return "", ErrInvalid
	}
	if _, e := s.Get(ctx, owner, id); e != nil {
		return "", e
	}
	code, e := randomToken()
	if e != nil {
		return "", e
	}
	r, e := s.repo.Decide(ctx, owner, id, decision == "allow", Hash(code), s.now().UTC())
	if e != nil {
		return "", e
	}
	u, _ := url.Parse(r.RedirectURI)
	q := u.Query()
	q.Set("state", r.State)
	if decision == "allow" {
		q.Set("code", code)
		q.Set("client_id", r.ClientID)
		q.Set("scope", r.Scope)
	} else {
		q.Set("error", "access_denied")
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Token exchanges a single-use code or refresh token without extending the grant.
func (s *Service) Token(ctx context.Context, kind, credential, redirect, verifier string) (Tokens, error) {
	if len(credential) == 0 || len(credential) > 2048 {
		return Tokens{}, ErrGrant
	}
	access, e := randomToken()
	if e != nil {
		return Tokens{}, e
	}
	refresh, e := randomToken()
	if e != nil {
		return Tokens{}, e
	}
	now := s.now().UTC()
	issue := Issue{Hash(access), Hash(refresh), now, now.Add(15 * time.Minute)}
	var until time.Time
	switch kind {
	case "authorization_code":
		if redirect != RedirectURI {
			return Tokens{}, ErrGrant
		}
		challenge := ""
		if verifier != "" {
			if !verifierPattern.MatchString(verifier) {
				return Tokens{}, ErrGrant
			}
			h := sha256.Sum256([]byte(verifier))
			challenge = base64.RawURLEncoding.EncodeToString(h[:])
		}
		until, e = s.repo.Exchange(ctx, s.Config.ClientID, Hash(credential), redirect, challenge, issue)
	case "refresh_token":
		until, e = s.repo.Refresh(ctx, s.Config.ClientID, Hash(credential), issue)
		refresh = credential
	default:
		return Tokens{}, ErrInvalid
	}
	if e != nil {
		return Tokens{}, e
	}
	if until.Before(issue.AccessUntil) {
		issue.AccessUntil = until
	}
	return Tokens{access, "Bearer", int(issue.AccessUntil.Sub(now) / time.Second), refresh, Scope}, nil
}

// List exposes active grant metadata without credentials.
func (s *Service) List(ctx context.Context, owner string) ([]Grant, error) {
	return s.repo.List(ctx, owner, s.Config.ClientID, s.now())
}

// Revoke disconnects an owner-scoped grant and all of its credentials.
func (s *Service) Revoke(ctx context.Context, owner, id string) error {
	return s.repo.Revoke(ctx, owner, id, s.Config.ClientID)
}

// RevokeToken implements client-authenticated, idempotent token revocation.
func (s *Service) RevokeToken(ctx context.Context, token string) error {
	return s.repo.RevokeToken(ctx, s.Config.ClientID, Hash(token))
}

// Verify checks access and correlates the grant with the configured skill and subject.
func (s *Service) Verify(ctx context.Context, token, skill, subject string) error {
	if skill != s.Config.SkillID || subject == "" || token == "" || len(token) > 2048 {
		return ErrGrant
	}
	return s.repo.Verify(ctx, s.Config.ClientID, Hash(token), skill, Hash(subject), s.now())
}
