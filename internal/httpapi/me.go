package httpapi

import (
	"net/http"

	"github.com/Dyuzhovsergey/planly/internal/auth"
)

type updateMeRequest struct {
	TimeZone string `json:"timeZone"`
}

func (handler *authHandler) me(response http.ResponseWriter, request *http.Request) {
	identity, ok := sessionIdentityFromContext(request.Context())
	if !ok {
		writeProblem(response, http.StatusUnauthorized, "authentication_required")
		return
	}

	writeJSON(response, http.StatusOK, authResponse{
		User:      makeUserResponse(identity.User),
		CSRFToken: identity.CSRFToken,
	})
}

func (handler *authHandler) updateMe(response http.ResponseWriter, request *http.Request) {
	identity, ok := sessionIdentityFromContext(request.Context())
	if !ok {
		writeProblem(response, http.StatusUnauthorized, "authentication_required")
		return
	}

	var body updateMeRequest
	if err := decodeJSON(response, request, &body); err != nil {
		writeProblem(response, http.StatusBadRequest, "invalid_request")
		return
	}

	user, err := handler.service.UpdateTimeZone(request.Context(), identity.User.ID, auth.UpdateTimeZoneInput{
		TimeZone: body.TimeZone,
	})
	if err != nil {
		handler.writeAuthError(response, err)
		return
	}

	writeJSON(response, http.StatusOK, authResponse{
		User:      makeUserResponse(user),
		CSRFToken: identity.CSRFToken,
	})
}
