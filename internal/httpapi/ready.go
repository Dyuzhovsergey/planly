package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

const readinessTimeout = time.Second

func handleReady(database ReadinessChecker) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), readinessTimeout)
		defer cancel()

		if err := database.Ping(ctx); err != nil {
			writeProblem(response, http.StatusServiceUnavailable, "database_unavailable")
			return
		}

		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]string{"status": "ok"})
	}
}

func writeProblem(response http.ResponseWriter, status int, code string) {
	response.Header().Set("Content-Type", "application/problem+json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(struct {
		Type   string `json:"type"`
		Title  string `json:"title"`
		Status int    `json:"status"`
		Code   string `json:"code"`
	}{
		Type:   "about:blank",
		Title:  http.StatusText(status),
		Status: status,
		Code:   code,
	})
}
