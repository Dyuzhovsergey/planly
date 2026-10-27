package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func profileString(v string) *string { return &v }
func TestUpdateProfileValidatesAtomically(t *testing.T) {
	r := &fakeRepository{updatedUser: User{ID: "owner", DisplayName: "Имя", TimeZone: "UTC", WeekStartsOn: "sunday", TimeFormat: "12h"}}
	s := newTestService(t, r, time.Now())
	user, err := s.UpdateProfile(context.Background(), "owner", ProfileUpdate{DisplayName: profileString(" Имя "), TimeZone: profileString(" UTC "), WeekStartsOn: profileString("sunday"), TimeFormat: profileString("12h")})
	if err != nil || user.ID != "owner" || r.updatedUserID != "owner" || *r.profile.DisplayName != "Имя" || *r.profile.TimeZone != "UTC" {
		t.Fatalf("%+v %v", user, err)
	}
	for _, input := range []ProfileUpdate{{}, {DisplayName: profileString(strings.Repeat("я", 101))}, {DisplayName: profileString("x\x00")}, {TimeZone: profileString("")}, {TimeZone: profileString("Local")}, {TimeZone: profileString("bad/zone")}, {WeekStartsOn: profileString("Tuesday"), DisplayName: profileString("valid")}, {TimeFormat: profileString("12")}} {
		r.updatedUserID = ""
		_, err := s.UpdateProfile(context.Background(), "owner", input)
		var validation *ValidationError
		if !errors.As(err, &validation) || r.updatedUserID != "" {
			t.Fatalf("invalid profile reached SQL: %+v %v", input, err)
		}
	}
	for _, name := range []string{"", strings.Repeat("😀", 100)} {
		if _, err := s.UpdateProfile(context.Background(), "owner", ProfileUpdate{DisplayName: &name}); err != nil {
			t.Fatal(err)
		}
		if r.profile.TimeZone != nil || r.profile.WeekStartsOn != nil || r.profile.TimeFormat != nil {
			t.Fatal("omitted preferences were replaced")
		}
	}
	r.updateTimeZoneErr = ErrNotFound
	if _, err := s.UpdateProfile(context.Background(), "owner", ProfileUpdate{TimeFormat: profileString("24h")}); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal(err)
	}
}
