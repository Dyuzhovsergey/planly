// Package httpapi contains Planly's HTTP routing and transport-level handlers.
package httpapi

import "net/http"

// NewRouter builds the HTTP handler used by the API server.
func NewRouter() http.Handler {
	router := http.NewServeMux()
	router.HandleFunc("GET /health", handleHealth)

	return router
}
