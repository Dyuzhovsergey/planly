// Package avatar validates profile images and manages the owner's avatar selection.
package avatar

import (
	"bytes"
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"io"
)

// MaxUploadBytes bounds the input before decoding an image.
const MaxUploadBytes = 2 << 20

// ErrInvalid marks an unsupported, corrupted or oversized image/selection.
var ErrInvalid = errors.New("invalid avatar")

// ErrNotFound means the authenticated owner has no avatar.
var ErrNotFound = errors.New("avatar not found")

//go:embed presets/*.png
var presets embed.FS

// Record is the persistent selection; preset bytes are shared embedded assets.
type Record struct {
	Key  string
	Data []byte
}

// Repository scopes all reads and atomic replacements to the session owner.
type Repository interface {
	Get(context.Context, string) (Record, error)
	Put(context.Context, string, Record) error
}

// Service applies file limits and preset rules before persistence.
type Service struct{ repository Repository }

// NewService assembles profile image storage without filesystem dependencies.
func NewService(repository Repository) *Service { return &Service{repository: repository} }

// Preset returns only one of the five approved images.
func Preset(id string) ([]byte, error) {
	switch id {
	case "preset-1", "preset-2", "preset-3", "preset-4", "preset-5":
		return presets.ReadFile("presets/" + id + ".png")
	}
	return nil, ErrInvalid
}

// SetPreset replaces an upload with an approved selection atomically.
func (s *Service) SetPreset(ctx context.Context, owner, id string) error {
	if _, err := Preset(id); err != nil {
		return ErrInvalid
	}
	return s.repository.Put(ctx, owner, Record{Key: id})
}

// Delete restores the initial-letter fallback and removes stored upload bytes.
func (s *Service) Delete(ctx context.Context, owner string) error {
	return s.repository.Put(ctx, owner, Record{})
}

// Get returns normalized PNG bytes for the trusted owner only.
func (s *Service) Get(ctx context.Context, owner string) ([]byte, error) {
	record, err := s.repository.Get(ctx, owner)
	if err != nil {
		return nil, err
	}
	if record.Key == "" {
		return nil, ErrNotFound
	}
	if len(record.Data) > 0 {
		return record.Data, nil
	}
	return Preset(record.Key)
}

// Upload verifies actual PNG/JPEG data, limits allocation, strips metadata and resizes.
// The old image is replaced only after decoding and encoding complete successfully.
func (s *Service) Upload(ctx context.Context, owner string, input io.Reader) error {
	data, err := io.ReadAll(io.LimitReader(input, MaxUploadBytes+1))
	if err != nil {
		return fmt.Errorf("read avatar: %w", err)
	}
	if len(data) > MaxUploadBytes {
		return ErrInvalid
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 || config.Width > 4096 || config.Height > 4096 || config.Width*config.Height > 8_000_000 {
		return ErrInvalid
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	width, height := config.Width, config.Height
	if width > 512 || height > 512 {
		if width >= height {
			height = max(1, height*512/width)
			width = 512
		} else {
			width = max(1, width*512/height)
			height = 512
		}
	}
	output := image.NewNRGBA(image.Rect(0, 0, width, height))
	bounds := source.Bounds()
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			output.Set(x, y, source.At(bounds.Min.X+x*config.Width/width, bounds.Min.Y+y*config.Height/height))
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, output); err != nil {
		return fmt.Errorf("encode avatar: %w", err)
	}
	var key [16]byte
	if _, err := rand.Read(key[:]); err != nil {
		return err
	}
	return s.repository.Put(ctx, owner, Record{Key: "upload-" + hex.EncodeToString(key[:]), Data: encoded.Bytes()})
}
