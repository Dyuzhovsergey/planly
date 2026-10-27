package httpapi

import (
	"bytes"
	"context"
	"github.com/Dyuzhovsergey/planly/internal/auth"
	"github.com/Dyuzhovsergey/planly/internal/avatar"
	"net/http"
	"net/http/httptest"
	"testing"
)

type avatarMemory struct{ records map[string]avatar.Record }

func (r *avatarMemory) Get(_ context.Context, id string) (avatar.Record, error) {
	return r.records[id], nil
}
func (r *avatarMemory) Put(_ context.Context, id string, record avatar.Record) error {
	r.records[id] = record
	return nil
}
func TestAvatarHTTPGuardsAndLifecycle(t *testing.T) {
	memory := &avatarMemory{records: map[string]avatar.Record{}}
	identity := &fakeAuthService{identity: auth.SessionIdentity{User: auth.User{ID: "trusted-owner"}, CSRFToken: "csrf"}}
	router := NewRouter(Dependencies{Auth: identity, Avatars: avatar.NewService(memory), AuthConfig: AuthConfig{AllowedOrigin: testOrigin}})
	send := func(method, path, media string, body []byte, cookie, csrf, origin bool, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewReader(body))
		r.Header.Set("Content-Type", media)
		if cookie {
			r.AddCookie(&http.Cookie{Name: localSessionCookie, Value: "session"})
		}
		if csrf {
			r.Header.Set("X-CSRF-Token", "csrf")
		}
		if origin {
			r.Header.Set("Origin", testOrigin)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s got %d want %d: %s", method, path, w.Code, status, w.Body.String())
		}
		return w
	}
	for _, method := range []string{"PUT", "DELETE"} {
		// Origin is checked before session and CSRF.
		send(method, "/api/v1/me/avatar", "application/json", []byte(`{"presetId":"preset-1"}`), true, true, false, 403)
		send(method, "/api/v1/me/avatar", "application/json", nil, false, true, true, 401)
		send(method, "/api/v1/me/avatar", "application/json", nil, true, false, true, 403)
	}
	send("GET", "/api/v1/me/avatar", "", nil, false, false, false, 401)
	send("GET", "/api/v1/me/avatar", "", nil, true, false, false, 404)
	send("PUT", "/api/v1/me/avatar", "application/json", []byte(`{"presetId":"preset-1"}`), true, true, true, 204)
	w := send("GET", "/api/v1/me/avatar", "", nil, true, false, false, 200)
	if w.Header().Get("Cache-Control") != "private, no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal(w.Header())
	}
	send("PUT", "/api/v1/me/avatar", "application/json", []byte(`{"presetId":"preset-2","userId":"other"}`), true, true, true, 400)
	send("PUT", "/api/v1/me/avatar", "application/json", []byte(`null`), true, true, true, 400)
	send("PUT", "/api/v1/me/avatar", "application/json", []byte(`{"presetId":"../evil"}`), true, true, true, 422)
	send("PUT", "/api/v1/me/avatar", "image/svg+xml", []byte(`<svg/>`), true, true, true, 415)
	send("PUT", "/api/v1/me/avatar", "image/png", []byte(`not png`), true, true, true, 422)
	send("PUT", "/api/v1/me/avatar", "image/png", make([]byte, avatar.MaxUploadBytes+1), true, true, true, 413)
	if memory.records["trusted-owner"].Key != "preset-1" {
		t.Fatal("failed upload lost existing avatar")
	}
	data, _ := avatar.Preset("preset-1")
	send("PUT", "/api/v1/me/avatar", "image/png", data, true, true, true, 204)
	send("GET", "/api/v1/me/avatar?v=old-version", "", nil, true, false, false, 200)
	identity.identity.User.ID = "other"
	send("GET", "/api/v1/me/avatar?v=upload-stolen", "", nil, true, false, false, 404)
	identity.identity.User.ID = "trusted-owner"
	send("GET", "/api/v1/me/avatar/presets/preset-5", "", nil, true, false, false, 200)
	send("GET", "/api/v1/me/avatar/presets/evil", "", nil, true, false, false, 404)
	send("DELETE", "/api/v1/me/avatar", "", nil, true, true, true, 204)
	send("DELETE", "/api/v1/me/avatar", "", nil, true, true, true, 204)
	send("GET", "/api/v1/me/avatar", "", nil, true, false, false, 404)
}
