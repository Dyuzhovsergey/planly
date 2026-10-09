package config

import "testing"

func TestLoad(t *testing.T) {
	t.Setenv("HTTP_ADDR", ":8090")
	t.Setenv("DATABASE_URL", "postgres://example")

	got, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got.HTTPAddr != ":8090" {
		t.Errorf("HTTPAddr = %q, want %q", got.HTTPAddr, ":8090")
	}
	if got.DatabaseURL != "postgres://example" {
		t.Errorf("DatabaseURL = %q, want %q", got.DatabaseURL, "postgres://example")
	}
}

func TestLoadUsesDefaultHTTPAddr(t *testing.T) {
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("DATABASE_URL", "postgres://example")

	got, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got.HTTPAddr != defaultHTTPAddr {
		t.Errorf("HTTPAddr = %q, want %q", got.HTTPAddr, defaultHTTPAddr)
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error")
	}
}
