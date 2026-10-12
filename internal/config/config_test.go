package config

import "testing"

func TestLoad(t *testing.T) {
	t.Setenv("HTTP_ADDR", ":8090")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ORIGIN", "https://planly.example")
	t.Setenv("COOKIE_SECURE", "true")

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
	if got.AppOrigin != "https://planly.example" {
		t.Errorf("AppOrigin = %q, want %q", got.AppOrigin, "https://planly.example")
	}
	if !got.CookieSecure {
		t.Error("CookieSecure = false, want true")
	}
}

func TestLoadUsesDefaultHTTPAddr(t *testing.T) {
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("COOKIE_SECURE", "")

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
	t.Setenv("APP_ORIGIN", "http://localhost:8080")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error")
	}
}

func TestLoadRequiresAppOrigin(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ORIGIN", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error")
	}
}

func TestLoadRejectsInvalidCookieSecure(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("COOKIE_SECURE", "sometimes")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error")
	}
}

func TestLoadRejectsOriginWithPath(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ORIGIN", "https://planly.example/api")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error")
	}
}
