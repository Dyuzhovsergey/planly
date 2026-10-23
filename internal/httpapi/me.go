package httpapi

import (
	"net/http"

	"github.com/Dyuzhovsergey/planly/internal/auth"
)

type updateMeRequest struct {
	TimeZone     optionalField[string] `json:"timeZone"`
	DisplayName  optionalField[string] `json:"displayName"`
	WeekStartsOn optionalField[string] `json:"weekStartsOn"`
	TimeFormat   optionalField[string] `json:"timeFormat"`
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

	var body optionalField[updateMeRequest]
	if err := decodeJSON(response, request, &body); err != nil {
		writeProblem(response, http.StatusBadRequest, "invalid_request")
		return
	}

	user, err := handler.service.UpdateProfile(request.Context(), identity.User.ID, auth.ProfileUpdate{
		TimeZone: profileField(&body.value.TimeZone), DisplayName: profileField(&body.value.DisplayName), WeekStartsOn: profileField(&body.value.WeekStartsOn), TimeFormat: profileField(&body.value.TimeFormat),
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

func profileField(field *optionalField[string]) *string {
	if !field.set {
		return nil
	}
	return &field.value
}
