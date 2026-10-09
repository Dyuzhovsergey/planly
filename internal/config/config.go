// Package config loads Planly's runtime configuration from the environment.
package config

import (
	"errors"
	"os"
)

const defaultHTTPAddr = ":8080"

// Config contains the settings required to start the API.
type Config struct {
	HTTPAddr    string
	DatabaseURL string
}

// Load reads configuration from environment variables and validates required values.
func Load() (Config, error) {
	config := Config{
		HTTPAddr:    os.Getenv("HTTP_ADDR"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
	}

	if config.HTTPAddr == "" {
		config.HTTPAddr = defaultHTTPAddr
	}
	if config.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}

	return config, nil
}
