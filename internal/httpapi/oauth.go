package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/oauth"
)

type oauthHandler struct{ service *oauth.Service }

func (h *oauthHandler) browser(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	identity, _ := sessionIdentityFromContext(r.Context())
	owner := identity.User.ID
	id := r.PathValue("id")
	if r.URL.RawQuery != "" {
		writeProblem(w, 400, "invalid_request")
		return
	}
	var result any
	var e error
	status := 200
	switch {
	case r.Method == "GET" && id == "" && strings.HasSuffix(r.URL.Path, "oauth-grants"):
		var items []oauth.Grant
		items, e = h.service.List(r.Context(), owner)
		result = struct {
			Items []oauth.Grant `json:"items"`
		}{items}
	case r.Method == "DELETE":
		e = h.service.Revoke(r.Context(), owner, id)
		status = 204
	case r.Method == "GET":
		result, e = h.service.Get(r.Context(), owner, id)
	case strings.HasSuffix(r.URL.Path, "/decision"):
		var body struct {
			Decision string `json:"decision"`
		}
		if e = decodeJSON(w, r, &body); e != nil {
			writeProblem(w, 400, "invalid_request")
			return
		}
		var redirect string
		redirect, e = h.service.Decide(r.Context(), owner, id, body.Decision)
		result = struct {
			Redirect string `json:"redirectUrl"`
		}{redirect}
	default:
		var body oauth.Input
		if e = decodeJSON(w, r, &body); e != nil {
			writeProblem(w, 400, "invalid_request")
			return
		}
		result, e = h.service.Create(r.Context(), owner, body)
		status = 201
	}
	if e != nil {
		switch {
		case errors.Is(e, oauth.ErrNotFound):
			writeProblem(w, 404, "not_found")
		case errors.Is(e, oauth.ErrConflict):
			writeProblem(w, 409, "conflict")
		case errors.Is(e, oauth.ErrInvalid):
			writeProblem(w, 400, "invalid_request")
		default:
			writeProblem(w, 500, "internal_error")
		}
		return
	}
	if status == 204 {
		w.WriteHeader(status)
	} else {
		writeJSON(w, status, result)
	}
}
func oauthError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	writeJSON(w, status, struct {
		Error string `json:"error"`
	}{code})
}
func (h *oauthHandler) token(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	if r.URL.RawQuery != "" || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/x-www-form-urlencoded") {
		oauthError(w, 400, "invalid_request")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if e := r.ParseForm(); e != nil {
		oauthError(w, 400, "invalid_request")
		return
	}
	for _, values := range r.PostForm {
		if len(values) != 1 {
			oauthError(w, 400, "invalid_request")
			return
		}
	}
	id, secret := r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	if values := r.Header.Values("Authorization"); len(values) > 0 {
		if len(values) != 1 || r.PostForm.Has("client_id") || r.PostForm.Has("client_secret") {
			oauthError(w, 400, "invalid_request")
			return
		}
		var ok bool
		id, secret, ok = r.BasicAuth()
		if !ok {
			w.Header().Set("WWW-Authenticate", `Basic realm="Planly OAuth"`)
			oauthError(w, 401, "invalid_client")
			return
		}
		var e error
		id, e = url.QueryUnescape(id)
		if e != nil {
			oauthError(w, 400, "invalid_request")
			return
		}
		secret, e = url.QueryUnescape(secret)
		if e != nil {
			oauthError(w, 400, "invalid_request")
			return
		}
	}
	if !h.service.Authenticate(id, secret) {
		w.Header().Set("WWW-Authenticate", `Basic realm="Planly OAuth"`)
		oauthError(w, 401, "invalid_client")
		return
	}
	if r.URL.Path == "/oauth/revoke" {
		if r.PostForm.Get("token") == "" {
			oauthError(w, 400, "invalid_request")
			return
		}
		if e := h.service.RevokeToken(r.Context(), r.PostForm.Get("token")); e != nil {
			oauthError(w, 500, "server_error")
			return
		}
		w.WriteHeader(200)
		return
	}
	kind := r.PostForm.Get("grant_type")
	if kind != "authorization_code" && kind != "refresh_token" {
		oauthError(w, 400, "unsupported_grant_type")
		return
	}
	if scope := r.PostForm.Get("scope"); scope != "" && scope != oauth.Scope {
		oauthError(w, 400, "invalid_scope")
		return
	}
	credential := r.PostForm.Get("code")
	if kind == "refresh_token" {
		credential = r.PostForm.Get("refresh_token")
	}
	tokens, e := h.service.Token(r.Context(), kind, credential, r.PostForm.Get("redirect_uri"), r.PostForm.Get("code_verifier"))
	if e != nil {
		if errors.Is(e, oauth.ErrGrant) || errors.Is(e, oauth.ErrInvalid) {
			oauthError(w, 400, "invalid_grant")
		} else {
			oauthError(w, 500, "server_error")
		}
		return
	}
	writeJSON(w, 200, tokens)
}

// uniqueJSON rejects duplicate keys at every nesting level, including authentication fields.
func uniqueJSON(data []byte) error {
	d := json.NewDecoder(strings.NewReader(string(data)))
	var value func() error
	value = func() error {
		t, e := d.Token()
		if e != nil {
			return e
		}
		if delim, ok := t.(json.Delim); ok {
			switch delim {
			case '{':
				seen := map[string]bool{}
				for d.More() {
					key, e := d.Token()
					if e != nil {
						return e
					}
					s, ok := key.(string)
					if !ok || seen[strings.ToLower(s)] {
						return oauth.ErrInvalid
					}
					seen[strings.ToLower(s)] = true
					if e = value(); e != nil {
						return e
					}
				}
			case '[':
				for d.More() {
					if e = value(); e != nil {
						return e
					}
				}
			default:
				return oauth.ErrInvalid
			}
			_, e = d.Token()
			return e
		}
		return nil
	}
	if e := value(); e != nil {
		return e
	}
	if _, e := d.Token(); e != io.EOF {
		return oauth.ErrInvalid
	}
	return nil
}
func (h *oauthHandler) webhook(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	w.Header().Set("Cache-Control", "no-store")
	data, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if e != nil {
		var max *http.MaxBytesError
		if errors.As(e, &max) {
			writeProblem(w, 413, "request_too_large")
		} else {
			writeProblem(w, 400, "invalid_request")
		}
		return
	}
	var body struct {
		Version string `json:"version"`
		Meta    struct {
			Interfaces map[string]json.RawMessage `json:"interfaces"`
		} `json:"meta"`
		Session struct {
			ID      string `json:"session_id"`
			Skill   string `json:"skill_id"`
			Message *int   `json:"message_id"`
			User    struct {
				ID    string `json:"user_id"`
				Token string `json:"access_token"`
			} `json:"user"`
		} `json:"session"`
		Request *struct {
			Type string `json:"type"`
		} `json:"request"`
		Complete json.RawMessage `json:"account_linking_complete_event"`
	}
	if uniqueJSON(data) != nil || json.Unmarshal(data, &body) != nil || body.Version != "1.0" || body.Session.ID == "" || body.Session.Message == nil || *body.Session.Message < 0 || (body.Request == nil && len(body.Complete) == 0) {
		writeProblem(w, 400, "invalid_request")
		return
	}
	if body.Session.Skill != h.service.Config.SkillID {
		writeProblem(w, 403, "forbidden")
		return
	}
	token := body.Session.User.Token
	if headers := r.Header.Values("Authorization"); len(headers) > 0 {
		if len(headers) != 1 {
			writeProblem(w, 400, "invalid_request")
			return
		}
		parts := strings.Fields(headers[0])
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || (token != "" && token != parts[1]) {
			writeProblem(w, 400, "invalid_request")
			return
		}
		token = parts[1]
	}
	e = h.service.Verify(ctx, token, body.Session.Skill, body.Session.User.ID)
	text := "Привяжите аккаунт Planly на устройстве с экраном."
	if e != nil && !errors.Is(e, oauth.ErrGrant) {
		text = "Не удалось проверить привязку. Попробуйте позже."
	} else if e != nil {
		if v, ok := body.Meta.Interfaces["account_linking"]; ok && strings.TrimSpace(string(v)) == "{}" {
			writeJSON(w, 200, map[string]any{"version": "1.0", "start_account_linking": struct{}{}})
			return
		}
	} else {
		text = "Аккаунт Planly привязан. Голосовое создание записей пока недоступно."
	}
	writeJSON(w, 200, map[string]any{"version": "1.0", "response": map[string]any{"text": text, "end_session": false}})
}
