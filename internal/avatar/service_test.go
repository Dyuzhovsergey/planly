package avatar

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

type memoryRepository struct {
	records map[string]Record
	writes  int
}

func (r *memoryRepository) Get(_ context.Context, id string) (Record, error) {
	return r.records[id], nil
}
func (r *memoryRepository) Put(_ context.Context, id string, record Record) error {
	r.records[id] = record
	r.writes++
	return nil
}
func TestAvatarLifecycleAndIsolation(t *testing.T) {
	ctx := context.Background()
	r := &memoryRepository{records: map[string]Record{}}
	s := NewService(r)
	for _, id := range []string{"preset-1", "preset-2", "preset-3", "preset-4", "preset-5"} {
		if err := s.SetPreset(ctx, "owner", id); err != nil {
			t.Fatal(err)
		}
		data, err := s.Get(ctx, "owner")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := png.Decode(bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Get(ctx, "other"); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	source := image.NewRGBA(image.Rect(0, 0, 1024, 256))
	source.Set(12, 12, color.RGBA{255, 10, 20, 255})
	var input bytes.Buffer
	if err := jpeg.Encode(&input, source, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.Upload(ctx, "owner", &input); err != nil {
		t.Fatal(err)
	}
	data, err := NewService(r).Get(ctx, "owner")
	if err != nil {
		t.Fatal(err)
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width != 512 || config.Height != 128 {
		t.Fatalf("config %+v %v", config, err)
	}
	key := r.records["owner"].Key
	if err := s.Upload(ctx, "owner", bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
	if key == r.records["owner"].Key {
		t.Fatal("replacement must change version")
	}
	if err := s.SetPreset(ctx, "owner", "preset-2"); err != nil {
		t.Fatal(err)
	}
	if len(r.records["owner"].Data) != 0 {
		t.Fatal("preset kept old upload")
	}
	if err := s.Delete(ctx, "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, "owner"); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}
func TestInvalidAvatarPreservesStoredImage(t *testing.T) {
	ctx := context.Background()
	r := &memoryRepository{records: map[string]Record{"owner": {Key: "preset-1"}}}
	s := NewService(r)
	var huge bytes.Buffer
	if err := png.Encode(&huge, image.NewNRGBA(image.Rect(0, 0, 4097, 1))); err != nil {
		t.Fatal(err)
	}
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, image.NewNRGBA(image.Rect(0, 0, 3000, 3000))); err != nil {
		t.Fatal(err)
	}
	valid, _ := Preset("preset-1")
	for name, data := range map[string][]byte{"svg": []byte(`<svg onload="evil()"/>`), "large": make([]byte, MaxUploadBytes+1), "dimensions": huge.Bytes(), "pixels": pixels.Bytes(), "corrupt": valid[:len(valid)/2]} {
		t.Run(name, func(t *testing.T) {
			if err := s.Upload(ctx, "owner", bytes.NewReader(data)); !errors.Is(err, ErrInvalid) {
				t.Fatalf("error %v", err)
			}
		})
	}
	if err := s.SetPreset(ctx, "owner", "../preset-1"); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if r.writes != 0 || r.records["owner"].Key != "preset-1" {
		t.Fatal("invalid image replaced saved selection")
	}
}
