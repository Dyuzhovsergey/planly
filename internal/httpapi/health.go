package httpapi

import (
	"encoding/json"
	"net/http"
)

type healthResponse struct {
	Status string `json:"status"`
}

func handleHealth(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)

	// Encoding this fixed response cannot fail for data-related reasons. A write
	// error only means that the client disconnected, after headers were sent.
	_ = json.NewEncoder(response).Encode(healthResponse{Status: "ok"})
}
