package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/Dyuzhovsergey/planly/internal/auth"
	"github.com/Dyuzhovsergey/planly/internal/httpapi"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/oauth"
)

func TestOAuthRepositoryIntegration(t *testing.T) {
	db := os.Getenv("PLANLY_TEST_DATABASE_URL")
	if db == "" {
		t.Skip("PLANLY_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p, e := Open(ctx, db)
	if e != nil {
		t.Fatal(e)
	}
	defer p.Close()
	suffix := time.Now().UnixNano()
	emails := []string{fmt.Sprintf("oauth-a-%d@example.com", suffix), fmt.Sprintf("oauth-b-%d@example.com", suffix)}
	defer p.Exec(context.Background(), `DELETE FROM users WHERE email=ANY($1)`, emails)
	owner := insertTaskTestUser(t, ctx, p, emails[0])
	other := insertTaskTestUser(t, ctx, p, emails[1])
	repo := NewOAuthRepository(p)
	s := oauth.NewService(repo, oauth.Config{ClientID: "test-client", SecretHash: oauth.Hash("secret"), SkillID: "test-skill"})
	input := oauth.Input{ClientID: "test-client", RedirectURI: oauth.RedirectURI, ResponseType: "code", State: "state&+/=", Scope: oauth.Scope}
	create := func(i oauth.Input) oauth.Request {
		t.Helper()
		v, e := s.Create(ctx, owner, i)
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	code := func(v oauth.Request) string {
		t.Helper()
		redirect, e := s.Decide(ctx, owner, v.ID, "allow")
		if e != nil {
			t.Fatal(e)
		}
		u, _ := url.Parse(redirect)
		if u.Query().Get("state") != input.State {
			t.Fatal("state changed")
		}
		return u.Query().Get("code")
	}
	v := create(input)
	if _, e = s.Get(ctx, other, v.ID); !errors.Is(e, oauth.ErrNotFound) {
		t.Fatal("foreign read", e)
	}
	if _, e = s.Decide(ctx, other, v.ID, "allow"); !errors.Is(e, oauth.ErrNotFound) {
		t.Fatal("foreign decision", e)
	}
	c := code(v)
	if _, e = s.Decide(ctx, owner, v.ID, "deny"); !errors.Is(e, oauth.ErrConflict) {
		t.Fatal("repeat decision", e)
	}
	var successes int
	var mu sync.Mutex
	var wg sync.WaitGroup
	var token oauth.Tokens
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, e := s.Token(ctx, "authorization_code", c, oauth.RedirectURI, "")
			mu.Lock()
			defer mu.Unlock()
			if e == nil {
				successes++
				token = got
			} else if !errors.Is(e, oauth.ErrGrant) {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	if successes != 1 {
		t.Fatalf("concurrent exchanges: %d", successes)
	}
	if token.Expires != 900 || token.Type != "Bearer" || token.Refresh == "" {
		t.Fatalf("bad token metadata %+v", token.Expires)
	}
	if e = s.Verify(ctx, token.Access, "test-skill", "alice-user"); e != nil {
		t.Fatal(e)
	}
	if e = s.Verify(ctx, token.Access, "test-skill", "other-alice-user"); !errors.Is(e, oauth.ErrGrant) {
		t.Fatal("rebound subject")
	}
	if e = s.Verify(ctx, token.Access, "other-skill", "alice-user"); !errors.Is(e, oauth.ErrGrant) {
		t.Fatal("foreign skill")
	}
	if e = s.Verify(ctx, token.Refresh, "test-skill", "alice-user"); !errors.Is(e, oauth.ErrGrant) {
		t.Fatal("refresh used as access")
	}
	refreshed, e := s.Token(ctx, "refresh_token", token.Refresh, "", "")
	if e != nil || refreshed.Refresh != token.Refresh {
		t.Fatal("refresh", e)
	}
	list, e := s.List(ctx, owner)
	if e != nil || len(list) != 1 {
		t.Fatal("list", e)
	}
	id := list[0].ID
	if e = s.Revoke(ctx, other, id); !errors.Is(e, oauth.ErrNotFound) {
		t.Fatal("foreign revoke")
	}
	if e = s.Revoke(ctx, owner, id); e != nil {
		t.Fatal(e)
	}
	if e = s.Revoke(ctx, owner, id); e != nil {
		t.Fatal("idempotent revoke")
	}
	for _, access := range []string{token.Access, refreshed.Access} {
		if e = s.Verify(ctx, access, "test-skill", "alice-user"); !errors.Is(e, oauth.ErrGrant) {
			t.Fatal("revoked access")
		}
	}
	if _, e = s.Token(ctx, "refresh_token", token.Refresh, "", ""); !errors.Is(e, oauth.ErrGrant) {
		t.Fatal("revoked refresh")
	}
	if e = s.RevokeToken(ctx, "unknown"); e != nil {
		t.Fatal(e)
	}
	// PKCE is mandatory when challenged; an invalid attempt must not consume the code.
	verifier := "01234567890123456789012345678901234567890123456789"
	digest := sha256.Sum256([]byte(verifier))
	pkce := input
	pkce.CodeChallenge = base64.RawURLEncoding.EncodeToString(digest[:])
	pkce.CodeChallengeMethod = "S256"
	c = code(create(pkce))
	if _, e = s.Token(ctx, "authorization_code", c, oauth.RedirectURI, ""); !errors.Is(e, oauth.ErrGrant) {
		t.Fatal("missing PKCE")
	}
	tok, e := s.Token(ctx, "authorization_code", c, oauth.RedirectURI, verifier)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.RevokeToken(ctx, tok.Refresh); e != nil {
		t.Fatal(e)
	}
	if e = s.Verify(ctx, tok.Access, "test-skill", "alice-user"); !errors.Is(e, oauth.ErrGrant) {
		t.Fatal("token revoke")
	}
	// Expired codes and requests do not authorize; denial does not create a grant.
	expired := create(input)
	_, e = p.Exec(ctx, `UPDATE oauth_authorization_requests SET expires_at=now()-interval '1 minute' WHERE id=$1`, expired.ID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Get(ctx, owner, expired.ID); !errors.Is(e, oauth.ErrNotFound) {
		t.Fatal("expired request")
	}
	denied := create(input)
	target, e := s.Decide(ctx, owner, denied.ID, "deny")
	if e != nil {
		t.Fatal(e)
	}
	u, _ := url.Parse(target)
	if u.Query().Get("error") != "access_denied" || u.Query().Get("code") != "" {
		t.Fatal("denial")
	}
	c = code(create(input))
	_, e = p.Exec(ctx, `UPDATE oauth_credentials SET expires_at=now()-interval '1 minute' WHERE token_hash=$1`, oauth.Hash(c))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Token(ctx, "authorization_code", c, oauth.RedirectURI, ""); !errors.Is(e, oauth.ErrGrant) {
		t.Fatal("expired code")
	}

	// A different registered client cannot exchange another client's code.
	otherService := oauth.NewService(repo, oauth.Config{ClientID: "different-client", SkillID: "test-skill"})
	otherCode := code(create(input))
	if _, err := otherService.Token(ctx, "authorization_code", otherCode, oauth.RedirectURI, ""); !errors.Is(err, oauth.ErrGrant) {
		t.Fatal("cross-client code accepted")
	}
	expiring, err := s.Token(ctx, "authorization_code", otherCode, oauth.RedirectURI, "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.Exec(ctx, `UPDATE oauth_grants SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id IN (SELECT grant_id FROM oauth_credentials WHERE token_hash=$1)`, oauth.Hash(expiring.Access))
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Verify(ctx, expiring.Access, "test-skill", "alice-user"); !errors.Is(err, oauth.ErrGrant) {
		t.Fatal("expired grant verified")
	}
	if _, err = s.Token(ctx, "refresh_token", expiring.Refresh, "", ""); !errors.Is(err, oauth.ErrGrant) {
		t.Fatal("expired grant refreshed")
	}
	// A revoke serializes with refresh; all outcomes must be unusable after it returns.
	active, err := s.Token(ctx, "authorization_code", code(create(input)), oauth.RedirectURI, "")
	if err != nil {
		t.Fatal(err)
	}
	issued := make(chan string, 8)
	var concurrent sync.WaitGroup
	for range 8 {
		concurrent.Add(1)
		go func() {
			defer concurrent.Done()
			v, err := s.Token(ctx, "refresh_token", active.Refresh, "", "")
			if err == nil {
				issued <- v.Access
			} else if !errors.Is(err, oauth.ErrGrant) {
				t.Error(err)
			}
		}()
	}
	if err = s.RevokeToken(ctx, active.Refresh); err != nil {
		t.Fatal(err)
	}
	concurrent.Wait()
	close(issued)
	for access := range issued {
		if err = s.Verify(ctx, access, "test-skill", "alice-user"); !errors.Is(err, oauth.ErrGrant) {
			t.Fatal("refresh raced past revoke")
		}
	}
	// No raw bearer credential is persisted.
	var count int
	e = p.QueryRow(ctx, `SELECT count(*) FROM oauth_credentials WHERE token_hash IN($1,$2,$3)`, token.Access, token.Refresh, c).Scan(&count)
	if e != nil || count != 0 {
		t.Fatal("raw token persisted", e)
	}
}

func TestOAuthHTTPIntegration(t *testing.T) {
	db := os.Getenv("PLANLY_TEST_DATABASE_URL")
	if db == "" {
		t.Skip("PLANLY_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	p, e := Open(ctx, db)
	if e != nil {
		t.Fatal(e)
	}
	defer p.Close()
	authService, e := auth.NewService(NewAuthRepository(p))
	if e != nil {
		t.Fatal(e)
	}
	suffix := time.Now().UnixNano()
	email := fmt.Sprintf("oauth-http-%d@example.com", suffix)
	defer p.Exec(ctx, `DELETE FROM users WHERE email=$1`, email)
	result, e := authService.Register(ctx, auth.RegisterInput{Username: fmt.Sprintf("oa%d", suffix), Email: email, Password: "test-password-123", TimeZone: "UTC"})
	if e != nil {
		t.Fatal(e)
	}
	service := oauth.NewService(NewOAuthRepository(p), oauth.Config{ClientID: "http-client", SecretHash: oauth.Hash("http-secret"), SkillID: "skill"})
	handler := httpapi.NewRouter(httpapi.Dependencies{Auth: authService, OAuth: service, AuthConfig: httpapi.AuthConfig{AllowedOrigin: "http://localhost:5173"}})
	call := func(method, path, body, kind string, status int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", kind)
		if strings.HasPrefix(path, "/api/v1/") {
			req.Header.Set("Origin", "http://localhost:5173")
			req.Header.Set("X-CSRF-Token", result.CSRFToken)
			req.AddCookie(&http.Cookie{Name: "planly_session", Value: result.SessionToken})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != status {
			t.Fatalf("%s %s got %d: %s", method, path, w.Code, w.Body.String())
		}
		return w
	}
	input := `{"clientId":"http-client","redirectUri":"https://social.yandex.net/broker/redirect","responseType":"code","state":"s","scope":"planly:voice:create"}`
	w := call("POST", "/api/v1/oauth/authorization-requests", input, "application/json", 201)
	var consent oauth.Request
	if e = json.Unmarshal(w.Body.Bytes(), &consent); e != nil {
		t.Fatal(e)
	}
	call("GET", "/api/v1/oauth/authorization-requests/"+consent.ID, "", "", 200)
	w = call("POST", "/api/v1/oauth/authorization-requests/"+consent.ID+"/decision", `{"decision":"allow"}`, "application/json", 200)
	var redirect struct {
		URL string `json:"redirectUrl"`
	}
	json.Unmarshal(w.Body.Bytes(), &redirect)
	u, _ := url.Parse(redirect.URL)
	form := url.Values{"client_id": {"http-client"}, "client_secret": {"http-secret"}, "grant_type": {"authorization_code"}, "code": {u.Query().Get("code")}, "redirect_uri": {oauth.RedirectURI}}
	w = call("POST", "/oauth/token", form.Encode(), "application/x-www-form-urlencoded", 200)
	var tokens oauth.Tokens
	json.Unmarshal(w.Body.Bytes(), &tokens)
	if tokens.Access == "" {
		t.Fatal("missing token")
	}
	call("POST", "/oauth/token", form.Encode(), "application/x-www-form-urlencoded", 400)
	call("GET", "/api/v1/me/oauth-grants", "", "", 200)
	form = url.Values{"client_id": {"http-client"}, "client_secret": {"http-secret"}, "grant_type": {"refresh_token"}, "refresh_token": {tokens.Refresh}}
	call("POST", "/oauth/token", form.Encode(), "application/x-www-form-urlencoded", 200)

	basic := httptest.NewRequest("POST", "/oauth/token", strings.NewReader(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {tokens.Refresh}}.Encode()))
	basic.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	basic.SetBasicAuth("http-client", "http-secret")
	basicResponse := httptest.NewRecorder()
	handler.ServeHTTP(basicResponse, basic)
	if basicResponse.Code != 200 {
		t.Fatalf("Basic authentication failed: %d", basicResponse.Code)
	}
	call("POST", "/oauth/revoke", url.Values{"client_id": {"http-client"}, "client_secret": {"http-secret"}, "token": {tokens.Access}}.Encode(), "application/x-www-form-urlencoded", 200)
	call("POST", "/oauth/token", form.Encode(), "application/x-www-form-urlencoded", 400)
}
