package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/auth"
)

const (
	localSessionCookie      = "planly_session"
	productionSessionCookie = "__Host-planly_session"
	maximumRequestBody      = 1 << 20
)

// AuthService describes authentication operations required by HTTP handlers.
type AuthService interface {
	Register(context.Context, auth.RegisterInput) (auth.AuthResult, error)
	Login(context.Context, auth.LoginInput) (auth.AuthResult, error)
	Logout(context.Context, string, string) error
	Authenticate(context.Context, string) (auth.SessionIdentity, error)
	UpdateTimeZone(context.Context, string, auth.UpdateTimeZoneInput) (auth.User, error)
}

// AuthConfig contains browser-facing authentication settings.
type AuthConfig struct {
	AllowedOrigin string
	CookieSecure  bool
}

type authHandler struct {
	service    AuthService
	origin     string
	cookieName string
	secure     bool
}

type registerRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
	TimeZone string `json:"timeZone"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type authResponse struct {
	User      userResponse `json:"user"`
	CSRFToken string       `json:"csrfToken"`
}

type userResponse struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	TimeZone  string    `json:"timeZone"`
	CreatedAt time.Time `json:"createdAt"`
}

func newAuthHandler(service AuthService, config AuthConfig) *authHandler {
	cookieName := localSessionCookie
	if config.CookieSecure {
		cookieName = productionSessionCookie
	}
	return &authHandler{
		service:    service,
		origin:     config.AllowedOrigin,
		cookieName: cookieName,
		secure:     config.CookieSecure,
	}
}

func (handler *authHandler) register(response http.ResponseWriter, request *http.Request) {
	if !handler.originAllowed(request) {
		writeProblem(response, http.StatusForbidden, "origin_not_allowed")
		return
	}

	var body registerRequest
	if err := decodeJSON(response, request, &body); err != nil {
		writeProblem(response, http.StatusBadRequest, "invalid_request")
		return
	}

	result, err := handler.service.Register(request.Context(), auth.RegisterInput{
		Username: body.Username,
		Email:    body.Email,
		Password: body.Password,
		TimeZone: body.TimeZone,
	})
	if err != nil {
		handler.writeAuthError(response, err)
		return
	}

	handler.setSessionCookie(response, result)
	writeJSON(response, http.StatusCreated, makeAuthResponse(result))
}

func (handler *authHandler) login(response http.ResponseWriter, request *http.Request) {
	if !handler.originAllowed(request) {
		writeProblem(response, http.StatusForbidden, "origin_not_allowed")
		return
	}

	var body loginRequest
	if err := decodeJSON(response, request, &body); err != nil {
		writeProblem(response, http.StatusBadRequest, "invalid_request")
		return
	}

	result, err := handler.service.Login(request.Context(), auth.LoginInput{
		Username: body.Username,
		Password: body.Password,
	})
	if err != nil {
		handler.writeAuthError(response, err)
		return
	}

	handler.setSessionCookie(response, result)
	writeJSON(response, http.StatusOK, makeAuthResponse(result))
}

func (handler *authHandler) logout(response http.ResponseWriter, request *http.Request) {
	if !handler.originAllowed(request) {
		writeProblem(response, http.StatusForbidden, "origin_not_allowed")
		return
	}

	cookie, err := request.Cookie(handler.cookieName)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "authentication_required")
		return
	}

	if err := handler.service.Logout(request.Context(), cookie.Value, request.Header.Get("X-CSRF-Token")); err != nil {
		handler.writeAuthError(response, err)
		return
	}

	handler.clearSessionCookie(response)
	response.WriteHeader(http.StatusNoContent)
}

func (handler *authHandler) originAllowed(request *http.Request) bool {
	return request.Header.Get("Origin") == handler.origin
}

func (handler *authHandler) setSessionCookie(response http.ResponseWriter, result auth.AuthResult) {
	http.SetCookie(response, &http.Cookie{
		Name:     handler.cookieName,
		Value:    result.SessionToken,
		Path:     "/",
		Expires:  result.SessionExpiresAt,
		MaxAge:   int(time.Until(result.SessionExpiresAt).Seconds()),
		HttpOnly: true,
		Secure:   handler.secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (handler *authHandler) clearSessionCookie(response http.ResponseWriter) {
	http.SetCookie(response, &http.Cookie{
		Name:     handler.cookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(1, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   handler.secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (handler *authHandler) writeAuthError(response http.ResponseWriter, err error) {
	var validationErr *auth.ValidationError
	switch {
	case errors.As(err, &validationErr):
		writeProblemWithErrors(response, http.StatusUnprocessableEntity, "validation_failed", validationErr.Fields)
	case errors.Is(err, auth.ErrEmailTaken):
		writeProblem(response, http.StatusConflict, "email_already_registered")
	case errors.Is(err, auth.ErrUsernameTaken):
		writeProblem(response, http.StatusConflict, "username_already_registered")
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeProblem(response, http.StatusUnauthorized, "invalid_credentials")
	case errors.Is(err, auth.ErrUnauthenticated):
		writeProblem(response, http.StatusUnauthorized, "authentication_required")
	case errors.Is(err, auth.ErrInvalidCSRF):
		writeProblem(response, http.StatusForbidden, "csrf_failed")
	default:
		slog.Error("authentication request failed", "error", err)
		writeProblem(response, http.StatusInternalServerError, "internal_error")
	}
}

func decodeJSON(response http.ResponseWriter, request *http.Request, destination any) error {
	request.Body = http.MaxBytesReader(response, request.Body, maximumRequestBody)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func makeAuthResponse(result auth.AuthResult) authResponse {
	return authResponse{
		User:      makeUserResponse(result.User),
		CSRFToken: result.CSRFToken,
	}
}

func makeUserResponse(user auth.User) userResponse {
	return userResponse{
		ID:        user.ID,
		Username:  user.Username,
		Email:     user.Email,
		TimeZone:  user.TimeZone,
		CreatedAt: user.CreatedAt.UTC(),
	}
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
