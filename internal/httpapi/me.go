package httpapi

import "net/http"

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
