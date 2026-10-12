// Package config loads Planly's runtime configuration from the environment.
package config

import (
	"errors"
	"net/url"
	"os"
	"strconv"
)

const defaultHTTPAddr = ":8080"

// Config contains the settings required to start the API.
type Config struct {
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
