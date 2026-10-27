package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/birthday"
)

// BirthdayService describes source CRUD and calculated calendar appearances.
type BirthdayService interface {
	Create(context.Context, string, string, birthday.CreateInput) (birthday.Birthday, error)
	GetByID(context.Context, string, string) (birthday.Birthday, error)
	Update(context.Context, string, string, string, birthday.UpdateInput) (birthday.Birthday, error)
	Delete(context.Context, string, string) error
	List(context.Context, string) ([]birthday.Birthday, error)
	Occurrences(context.Context, string, birthday.RangeInput) ([]birthday.Occurrence, error)
}

// nullableBirthdayYear distinguishes missing, null and integer JSON values.
type nullableBirthdayYear struct {
	set   bool
	value *int
}

func (field *nullableBirthdayYear) UnmarshalJSON(data []byte) error {
	if err := json.Unmarshal(data, &field.value); err != nil {
		return err
	}
	field.set = true
	return nil
}

type birthdayRequest struct {
	Name      optionalField[string] `json:"name"`
	Month     optionalField[int]    `json:"month"`
	Day       optionalField[int]    `json:"day"`
	BirthYear nullableBirthdayYear  `json:"birthYear"`
	Note      optionalField[string] `json:"note"`
}

type birthdayResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Month     int       `json:"month"`
	Day       int       `json:"day"`
	BirthYear *int      `json:"birthYear"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type birthdayOccurrenceResponse struct {
	BirthdayID string `json:"birthdayId"`
	Name       string `json:"name"`
	Date       string `json:"date"`
	Age        *int   `json:"age"`
}

type birthdayHandler struct{ service BirthdayService }

func (h *birthdayHandler) create(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	var body optionalField[birthdayRequest]
	if r.URL.RawQuery != "" {
		writeProblem(w, 400, "invalid_request")
		return
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeProblem(w, 400, "invalid_request")
		return
	}
	v := body.value
	value, err := h.service.Create(r.Context(), identity.User.ID, identity.User.TimeZone, birthday.CreateInput{Name: v.Name.value, Month: v.Month.value, Day: v.Day.value, BirthYear: v.BirthYear.value, Note: v.Note.value})
	h.writeResult(w, 201, value, err)
}

func (h *birthdayHandler) getByID(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	if r.URL.RawQuery != "" {
		writeProblem(w, 400, "invalid_request")
		return
	}
	value, err := h.service.GetByID(r.Context(), identity.User.ID, r.PathValue("id"))
	h.writeResult(w, 200, value, err)
}

func (h *birthdayHandler) update(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	if r.URL.RawQuery != "" {
		writeProblem(w, 400, "invalid_request")
		return
	}
	var body optionalField[birthdayRequest]
	if err := decodeJSON(w, r, &body); err != nil {
		writeProblem(w, 400, "invalid_request")
		return
	}
	v := body.value
	input := birthday.UpdateInput{Name: birthdayFieldPointer(&v.Name), Month: birthdayFieldPointer(&v.Month), Day: birthdayFieldPointer(&v.Day), Note: birthdayFieldPointer(&v.Note), BirthYearSet: v.BirthYear.set, BirthYear: v.BirthYear.value}
	value, err := h.service.Update(r.Context(), identity.User.ID, identity.User.TimeZone, r.PathValue("id"), input)
	h.writeResult(w, 200, value, err)
}

func birthdayFieldPointer[T any](field *optionalField[T]) *T {
	if !field.set {
		return nil
	}
	return &field.value
}

func (h *birthdayHandler) delete(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	if r.URL.RawQuery != "" {
		writeProblem(w, 400, "invalid_request")
		return
	}
	if err := h.service.Delete(r.Context(), identity.User.ID, r.PathValue("id")); err != nil {
		h.writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *birthdayHandler) list(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	if r.URL.RawQuery != "" {
		writeProblem(w, 400, "invalid_request")
		return
	}
	values, err := h.service.List(r.Context(), identity.User.ID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	items := make([]birthdayResponse, 0, len(values))
	for _, value := range values {
		items = append(items, makeBirthdayResponse(value))
	}
	writeJSON(w, 200, struct {
		Items []birthdayResponse `json:"items"`
	}{Items: items})
}

func (h *birthdayHandler) occurrences(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	query, ok := parseTaskListQuery(r.URL.RawQuery)
	if !ok {
		writeProblem(w, 400, "invalid_request")
		return
	}
	values, err := h.service.Occurrences(r.Context(), identity.User.ID, birthday.RangeInput{From: query.From, To: query.To})
	if err != nil {
		h.writeError(w, err)
		return
	}
	items := make([]birthdayOccurrenceResponse, 0, len(values))
	for _, value := range values {
		items = append(items, birthdayOccurrenceResponse{BirthdayID: value.BirthdayID, Name: value.Name, Date: value.Date, Age: value.Age})
	}
	writeJSON(w, 200, struct {
		Items []birthdayOccurrenceResponse `json:"items"`
	}{Items: items})
}

func (h *birthdayHandler) writeResult(w http.ResponseWriter, status int, value birthday.Birthday, err error) {
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, status, makeBirthdayResponse(value))
}

func (h *birthdayHandler) writeError(w http.ResponseWriter, err error) {
	if errors.Is(err, birthday.ErrNotFound) {
		writeProblem(w, 404, "birthday_not_found")
		return
	}
	var validation *birthday.ValidationError
	if errors.As(err, &validation) {
		writeProblemWithErrors(w, 422, "validation_failed", validation.Fields)
		return
	}
	slog.Error("birthday request failed", "error", err)
	writeProblem(w, 500, "internal_error")
}

func makeBirthdayResponse(value birthday.Birthday) birthdayResponse {
	return birthdayResponse{ID: value.ID, Name: value.Name, Month: value.Date.Month(), Day: value.Date.Day(), BirthYear: value.Date.BirthYear(), Note: value.Note, CreatedAt: value.CreatedAt.UTC(), UpdatedAt: value.UpdatedAt.UTC()}
}
