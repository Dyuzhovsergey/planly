package httpapi

import (
	"context"
	"errors"
	"github.com/Dyuzhovsergey/planly/internal/avatar"
	"io"
	"mime"
	"net/http"
)

// AvatarService keeps image validation and storage outside the transport layer.
type AvatarService interface {
	Get(context.Context, string) ([]byte, error)
	Upload(context.Context, string, io.Reader) error
	SetPreset(context.Context, string, string) error
	Delete(context.Context, string) error
}
type avatarHandler struct{ service AvatarService }

func (h *avatarHandler) get(w http.ResponseWriter, r *http.Request) {
	identity, _ := sessionIdentityFromContext(r.Context())
	data, err := h.service.Get(r.Context(), identity.User.ID)
	if err != nil {
		h.failure(w, err)
		return
	}
	writeAvatar(w, data)
}
func (h *avatarHandler) preset(w http.ResponseWriter, r *http.Request) {
	data, err := avatar.Preset(r.PathValue("id"))
	if err != nil {
		writeProblem(w, 404, "not_found")
		return
	}
	writeAvatar(w, data)
}
func writeAvatar(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	_, _ = w.Write(data)
}
func (h *avatarHandler) put(w http.ResponseWriter, r *http.Request) {
	identity, _ := sessionIdentityFromContext(r.Context())
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil {
		writeProblem(w, 415, "unsupported_media_type")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, avatar.MaxUploadBytes)
	switch media {
	case "application/json":
		var body optionalField[struct {
			PresetID string `json:"presetId"`
		}]
		if err := decodeJSON(w, r, &body); err != nil {
			writeProblem(w, 400, "invalid_request")
			return
		}
		err = h.service.SetPreset(r.Context(), identity.User.ID, body.value.PresetID)
	case "image/png", "image/jpeg":
		err = h.service.Upload(r.Context(), identity.User.ID, r.Body)
	default:
		writeProblem(w, 415, "unsupported_media_type")
		return
	}
	if err != nil {
		h.failure(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *avatarHandler) delete(w http.ResponseWriter, r *http.Request) {
	identity, _ := sessionIdentityFromContext(r.Context())
	if err := h.service.Delete(r.Context(), identity.User.ID); err != nil {
		h.failure(w, err)
		return
	}
	w.WriteHeader(204)
}
func (h *avatarHandler) failure(w http.ResponseWriter, err error) {
	var limit *http.MaxBytesError
	switch {
	case errors.As(err, &limit):
		writeProblem(w, 413, "request_too_large")
	case errors.Is(err, avatar.ErrInvalid):
		writeProblem(w, 422, "invalid_avatar")
	case errors.Is(err, avatar.ErrNotFound):
		writeProblem(w, 404, "not_found")
	default:
		writeProblem(w, 500, "internal_error")
	}
}
