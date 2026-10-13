package auth

import "testing"

func TestDeriveCSRFTokenIsStableAndSessionSpecific(t *testing.T) {
	first := deriveCSRFToken("first-session-token")
	if first == "" {
		t.Fatal("deriveCSRFToken() returned an empty token")
	}
	if repeated := deriveCSRFToken("first-session-token"); repeated != first {
		t.Errorf("repeated token = %q, want %q", repeated, first)
	}
	if second := deriveCSRFToken("second-session-token"); second == first {
		t.Error("different sessions received the same CSRF token")
	}
}
