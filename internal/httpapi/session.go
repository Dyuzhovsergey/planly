package httpapi

import (
	"context"
	"net/http"

	"github.com/Dyuzhovsergey/planly/internal/auth"
)

type sessionIdentityContextKey struct{}

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

func sessionIdentityFromContext(ctx context.Context) (auth.SessionIdentity, bool) {
	identity, ok := ctx.Value(sessionIdentityContextKey{}).(auth.SessionIdentity)
	return identity, ok
}
