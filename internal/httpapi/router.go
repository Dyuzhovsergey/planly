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

// NewRouter builds the HTTP handler used by the API server.
func NewRouter(database ReadinessChecker) http.Handler {
	router := http.NewServeMux()
	router.HandleFunc("GET /health", handleHealth)
	router.HandleFunc("GET /ready", handleReady(database))

	return router
}
