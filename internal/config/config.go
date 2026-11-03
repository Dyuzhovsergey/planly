// Package config loads Planly's runtime configuration from the environment.
package config

import (
	"encoding/hex"
	"errors"
	"github.com/Dyuzhovsergey/planly/internal/oauth"
	"net/url"
	"os"
	"strconv"
)

const defaultHTTPAddr = ":8080"

// Config contains the settings required to start the API.
type Config struct {
	OAuth        oauth.Config
	HTTPAddr     string
	DatabaseURL  string
	AppOrigin    string
	CookieSecure bool
}

// Load reads configuration from environment variables and validates required values.
func Load() (Config, error) {
	config := Config{
		HTTPAddr:    os.Getenv("HTTP_ADDR"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		AppOrigin:   os.Getenv("APP_ORIGIN"),
	}

	if config.HTTPAddr == "" {
		config.HTTPAddr = defaultHTTPAddr
	}
	if config.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if config.AppOrigin == "" {
		return Config{}, errors.New("APP_ORIGIN is required")
	}
	if !validOrigin(config.AppOrigin) {
		return Config{}, errors.New("APP_ORIGIN must contain only an http or https origin")
	}

	if value := os.Getenv("COOKIE_SECURE"); value != "" {
		cookieSecure, err := strconv.ParseBool(value)
		if err != nil {
			return Config{}, errors.New("COOKIE_SECURE must be true or false")
		}
		config.CookieSecure = cookieSecure
	}

	config.OAuth = oauth.Config{ClientID: os.Getenv("ALICE_CLIENT_ID"), SecretHash: os.Getenv("ALICE_CLIENT_SECRET_SHA256"), SkillID: os.Getenv("ALICE_SKILL_ID")}
	c := config.OAuth
	if c.ClientID != "" || c.SecretHash != "" || c.SkillID != "" {
		hash, err := hex.DecodeString(c.SecretHash)
		if c.ClientID == "" || len(c.ClientID) > 200 || c.SkillID == "" || len(c.SkillID) > 200 || err != nil || len(hash) != 32 || hex.EncodeToString(hash) != c.SecretHash {
			return Config{}, errors.New("ALICE_CLIENT_ID, ALICE_CLIENT_SECRET_SHA256 (lowercase SHA-256 hex) and ALICE_SKILL_ID must be configured together")
		}
	}
	return config, nil
}

func validOrigin(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil {
		return false
	}
	return (parsed.Scheme == "http" || parsed.Scheme == "https") &&
		parsed.Host != "" &&
		parsed.User == nil &&
		parsed.Path == "" &&
		parsed.RawQuery == "" &&
		parsed.Fragment == ""
}
