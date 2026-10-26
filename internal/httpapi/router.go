// Package httpapi contains Planly's HTTP routing and transport-level handlers.
package httpapi

import (
	"context"
	"github.com/Dyuzhovsergey/planly/internal/recurrence"
	"net/http"
)

// ReadinessChecker verifies that a required service is available.
type ReadinessChecker interface {
	Ping(context.Context) error
}

// Dependencies contains explicitly assembled HTTP-layer dependencies.
type Dependencies struct {
	Recurrence RecurrenceService
	Avatars    AvatarService
	Database   ReadinessChecker
	Auth       AuthService
	Tasks      TaskService
	Events     EventService
	Birthdays  BirthdayService
	Notes      NoteService
	AuthConfig AuthConfig
}

// NewRouter builds the HTTP handler used by the API server.
func NewRouter(dependencies Dependencies) http.Handler {
	router := http.NewServeMux()
	router.HandleFunc("GET /health", handleHealth)
	router.HandleFunc("GET /ready", handleReady(dependencies.Database))

	if dependencies.Auth != nil {
		auth := newAuthHandler(dependencies.Auth, dependencies.AuthConfig)
		router.HandleFunc("POST /api/v1/auth/register", auth.register)
		router.HandleFunc("POST /api/v1/auth/login", auth.login)
		router.HandleFunc("POST /api/v1/auth/logout", auth.logout)
		router.Handle("GET /api/v1/me", auth.requireSession(http.HandlerFunc(auth.me)))
		router.Handle(
			"PATCH /api/v1/me",
			auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(auth.updateMe)))),
		)
		if dependencies.Recurrence != nil {
			for _, kind := range []recurrence.Kind{recurrence.Task, recurrence.Event} {
				prefix := "/api/v1/" + string(kind) + "-series"
				h := &recurrenceHandler{service: dependencies.Recurrence, kind: kind, prefix: prefix}
				router.Handle("POST "+prefix, auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(h.noQuery(h.create))))))
				router.Handle("GET "+prefix+"/occurrences", auth.requireSession(http.HandlerFunc(h.list)))
				router.Handle("GET "+prefix+"/{id}", auth.requireSession(http.HandlerFunc(h.noQuery(h.get))))
				router.Handle("PATCH "+prefix+"/{id}", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(h.noQuery(h.update))))))
				router.Handle("DELETE "+prefix+"/{id}", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(h.noQuery(h.delete))))))
				router.Handle("GET "+prefix+"/{id}/occurrences/{date}", auth.requireSession(http.HandlerFunc(h.noQuery(h.getOccurrence))))
				router.Handle("PATCH "+prefix+"/{id}/occurrences/{date}", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(h.noQuery(h.updateOccurrence))))))
				router.Handle("DELETE "+prefix+"/{id}/occurrences/{date}", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(h.noQuery(h.deleteOccurrence))))))
			}
		}
		if dependencies.Avatars != nil {
			avatars := &avatarHandler{service: dependencies.Avatars}
			router.Handle("GET /api/v1/me/avatar", auth.requireSession(http.HandlerFunc(avatars.get)))
			router.Handle("GET /api/v1/me/avatar/presets/{id}", auth.requireSession(http.HandlerFunc(avatars.preset)))
			router.Handle("PUT /api/v1/me/avatar", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(avatars.put)))))
			router.Handle("DELETE /api/v1/me/avatar", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(avatars.delete)))))
		}
		if dependencies.Notes != nil {
			notes := &noteHandler{service: dependencies.Notes}
			router.Handle("GET /api/v1/notes", auth.requireSession(http.HandlerFunc(notes.serve)))
			router.Handle("GET /api/v1/notes/{id}", auth.requireSession(http.HandlerFunc(notes.serve)))
			for _, route := range []string{"POST /api/v1/notes", "PUT /api/v1/notes/{id}", "DELETE /api/v1/notes/{id}"} {
				router.Handle(route, auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(notes.serve)))))
			}
		}
		if dependencies.Birthdays != nil {
			birthdays := &birthdayHandler{service: dependencies.Birthdays}
			router.Handle("GET /api/v1/birthdays", auth.requireSession(http.HandlerFunc(birthdays.list)))
			router.Handle("GET /api/v1/birthdays/occurrences", auth.requireSession(http.HandlerFunc(birthdays.occurrences)))
			router.Handle("GET /api/v1/birthdays/{id}", auth.requireSession(http.HandlerFunc(birthdays.getByID)))
			router.Handle("POST /api/v1/birthdays", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(birthdays.create)))))
			router.Handle("PATCH /api/v1/birthdays/{id}", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(birthdays.update)))))
			router.Handle("DELETE /api/v1/birthdays/{id}", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(birthdays.delete)))))
		}
		if dependencies.Events != nil {
			events := &eventHandler{service: dependencies.Events}
			router.Handle("GET /api/v1/events", auth.requireSession(http.HandlerFunc(events.list)))
			router.Handle("GET /api/v1/events/{id}", auth.requireSession(http.HandlerFunc(events.getByID)))
			router.Handle("POST /api/v1/events", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(events.create)))))
			router.Handle("PATCH /api/v1/events/{id}", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(events.update)))))
			router.Handle("DELETE /api/v1/events/{id}", auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(events.delete)))))
		}
		if dependencies.Tasks != nil {
			tasks := newTaskHandler(dependencies.Tasks)
			router.Handle(
				"GET /api/v1/tasks",
				auth.requireSession(http.HandlerFunc(tasks.list)),
			)
			router.Handle(
				"GET /api/v1/tasks/{id}",
				auth.requireSession(http.HandlerFunc(tasks.getByID)),
			)
			router.Handle(
				"PATCH /api/v1/tasks/{id}",
				auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(tasks.update)))),
			)
			router.Handle(
				"DELETE /api/v1/tasks/{id}",
				auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(tasks.delete)))),
			)
			router.Handle(
				"POST /api/v1/tasks",
				auth.requireOrigin(auth.requireSession(auth.requireCSRF(http.HandlerFunc(tasks.create)))),
			)
		}
	}

	return router
}
