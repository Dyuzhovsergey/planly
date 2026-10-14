package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"net/http"

	"github.com/Dyuzhovsergey/planly/internal/auth"
)

type sessionIdentityContextKey struct{}

func (handler *authHandler) requireOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if !handler.originAllowed(request) {
			writeProblem(response, http.StatusForbidden, "origin_not_allowed")
			return
		}
		next.ServeHTTP(response, request)
	})
}

func (handler *authHandler) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		cookie, err := request.Cookie(handler.cookieName)
		if err != nil || cookie.Value == "" {
			writeProblem(response, http.StatusUnauthorized, "authentication_required")
			return
		}

		identity, err := handler.service.Authenticate(request.Context(), cookie.Value)
		if err != nil {
			handler.writeAuthError(response, err)
			return
		}

		ctx := context.WithValue(request.Context(), sessionIdentityContextKey{}, identity)
		next.ServeHTTP(response, request.WithContext(ctx))
	})
}

func (handler *authHandler) requireCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		identity, ok := sessionIdentityFromContext(request.Context())
		if !ok {
			writeProblem(response, http.StatusUnauthorized, "authentication_required")
			return
		}

		provided := request.Header.Get("X-CSRF-Token")
		if provided == "" {
			writeProblem(response, http.StatusForbidden, "csrf_failed")
			return
		}

		providedHash := sha256.Sum256([]byte(provided))
		expectedHash := sha256.Sum256([]byte(identity.CSRFToken))
		if subtle.ConstantTimeCompare(providedHash[:], expectedHash[:]) != 1 {
			writeProblem(response, http.StatusForbidden, "csrf_failed")
			return
		}

		next.ServeHTTP(response, request)
	})
}

func sessionIdentityFromContext(ctx context.Context) (auth.SessionIdentity, bool) {
	identity, ok := ctx.Value(sessionIdentityContextKey{}).(auth.SessionIdentity)
	return identity, ok
}
