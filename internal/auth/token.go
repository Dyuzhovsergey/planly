package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
)

const tokenBytes = 32

const csrfPurpose = "planly.csrf.v1"

func newToken(random io.Reader) (string, []byte, error) {
	raw := make([]byte, tokenBytes)
	if _, err := io.ReadFull(random, raw); err != nil {
		return "", nil, fmt.Errorf("read random token: %w", err)
	}

	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, hashToken(token), nil
}

func hashToken(token string) []byte {
	hash := sha256.Sum256([]byte(token))
	return hash[:]
}

func deriveCSRFToken(sessionToken string) string {
	mac := hmac.New(sha256.New, []byte(sessionToken))
	_, _ = mac.Write([]byte(csrfPurpose))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

var cryptoRandom io.Reader = rand.Reader
