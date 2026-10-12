package httpapi

import (
	"encoding/json"
	"net/http"
)

type problemResponse struct {
	Type   string              `json:"type"`
	Title  string              `json:"title"`
	Status int                 `json:"status"`
	Code   string              `json:"code"`
	Errors map[string][]string `json:"errors,omitempty"`
}

func writeProblem(response http.ResponseWriter, status int, code string) {
	writeProblemWithErrors(response, status, code, nil)
}

func writeProblemWithErrors(response http.ResponseWriter, status int, code string, fields map[string][]string) {
	response.Header().Set("Content-Type", "application/problem+json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(problemResponse{
		Type:   "about:blank",
		Title:  http.StatusText(status),
		Status: status,
		Code:   code,
		Errors: fields,
	})
}
