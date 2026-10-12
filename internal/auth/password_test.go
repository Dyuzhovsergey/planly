package auth

import (
	"crypto/rand"
	"strings"
	"testing"
)

func TestPasswordHasher(t *testing.T) {
	hasher := passwordHasher{random: rand.Reader}
	hash, err := hasher.Hash("correct horse battery staple")
	if err != nil {
		t.Fatalf("Hash() error = %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatalf("hash = %q, want Argon2id PHC format", hash)
	}

	valid, err := hasher.Verify("correct horse battery staple", hash)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if !valid {
		t.Fatal("Verify() = false, want true")
	}

	valid, err = hasher.Verify("wrong password value", hash)
	if err != nil {
		t.Fatalf("Verify(wrong password) error = %v", err)
	}
	if valid {
		t.Fatal("Verify(wrong password) = true, want false")
	}
}

func TestPasswordHasherRejectsMalformedHash(t *testing.T) {
	hasher := passwordHasher{random: rand.Reader}
	if _, err := hasher.Verify("password", "not-a-password-hash"); err == nil {
		t.Fatal("Verify() error = nil, want malformed hash error")
	}
}
