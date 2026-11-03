package oauth

import (
	"context"
	"errors"
	"testing"
)

func TestValidationBeforeStorage(t *testing.T) {
	s := NewService(nil, Config{ClientID: "client", SecretHash: Hash("secret"), SkillID: "skill"})
	if !s.Authenticate("client", "secret") || s.Authenticate("client", "wrong") || s.Authenticate("wrong", "secret") {
		t.Fatal("client authentication")
	}
	valid := Input{ClientID: "client", RedirectURI: RedirectURI, ResponseType: "code", State: "state", Scope: Scope}
	cases := []func(*Input){func(i *Input) { i.ClientID = "wrong" }, func(i *Input) { i.RedirectURI += "?evil=1" }, func(i *Input) { i.State = "" }, func(i *Input) { i.Scope += " read" }, func(i *Input) { i.ResponseType = "token" }, func(i *Input) { i.CodeChallenge = "x"; i.CodeChallengeMethod = "S256" }, func(i *Input) { i.CodeChallengeMethod = "plain" }}
	for _, change := range cases {
		i := valid
		change(&i)
		if _, e := s.Create(context.Background(), "owner", i); !errors.Is(e, ErrInvalid) {
			t.Fatal(e)
		}
	}
	for _, pair := range [][2]string{{"wrong", "user"}, {"skill", ""}} {
		if e := s.Verify(context.Background(), "token", pair[0], pair[1]); !errors.Is(e, ErrGrant) {
			t.Fatal(e)
		}
	}
}
