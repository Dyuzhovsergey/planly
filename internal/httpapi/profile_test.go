package httpapi

import (
	"github.com/Dyuzhovsergey/planly/internal/auth"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProfileHTTPFieldsAndStrictJSON(t *testing.T) {
	for _, body := range []string{`null`, `[]`, `{"displayName":null}`, `{"timeZone":null}`, `{"weekStartsOn":null}`, `{"timeFormat":null}`, `{"timeFormat":12}`, `{"displayName":true}`, `{"username":"rename"}`, `{"email":"rename@example.com"}`, `{"userId":"foreign"}`, `{} {}`} {
		s := authenticatedTaskService()
		w := httptest.NewRecorder()
		newTestAuthRouter(s, false).ServeHTTP(w, newUpdateMeRequest(body))
		if w.Code != 400 || s.updatedUserID != "" {
			t.Fatalf("%s => %d %s", body, w.Code, w.Body)
		}
	}
	s := authenticatedTaskService()
	s.updatedUser = auth.User{ID: "trusted-user-id", DisplayName: "Новое", WeekStartsOn: "sunday", TimeFormat: "12h"}
	w := httptest.NewRecorder()
	newTestAuthRouter(s, false).ServeHTTP(w, newUpdateMeRequest(`{"displayName":"Новое","weekStartsOn":"sunday","timeFormat":"12h"}`))
	if w.Code != 200 || s.updatedUserID != "trusted-user-id" || s.profile.TimeZone != nil || s.profile.DisplayName == nil || *s.profile.TimeFormat != "12h" || !strings.Contains(w.Body.String(), `"displayName":"Новое"`) {
		t.Fatalf("%d %s %+v", w.Code, w.Body, s.profile)
	}
}
