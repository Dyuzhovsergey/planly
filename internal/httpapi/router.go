// Package httpapi contains Planly's HTTP routing and transport-level handlers.
package httpapi

import (
	"context"
	"net/http"
)

// ReadinessChecker verifies that a required service is available.
type ReadinessChecker interface {
	Ping(context.Context) error
}

// Dependencies contains explicitly assembled HTTP-layer dependencies.
type Dependencies struct {
	Database   ReadinessChecker
	Auth       AuthService
	AuthConfig AuthConfig
}

// NewRouter builds the HTTP handler used by the API server.
func NewRouter(dependencies Dependencies) http.Handler {
	router := http.NewServeMux()
	router.HandleFunc("GET /health", handleHealth)
	router.HandleFunc("GET /ready", handleReady(dependencies.Database))

	if dependencies.Auth != nil {
		auth := newAuthHandler(dependencies.Auth, dependencies.AuthConfig)
		router.HandleFunc("POST /api/v1/auth/register", auth.register)
		router.HandleFunc("POST /api/v1/auth/login", auth.login)
		router.HandleFunc("POST /api/v1/auth/logout", auth.logout)
		router.Handle("GET /api/v1/me", auth.requireSession(http.HandlerFunc(auth.me)))
		router.Handle(
			"PATCH /api/v1/me",
			auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(auth.updateMe)))),
		)
	}

	return router
}
