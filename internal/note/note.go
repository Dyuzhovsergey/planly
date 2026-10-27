// Package note contains personal text notes and ordered checklists.
package note

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// Item is an ordered checklist entry; its position belongs to the whole document.
type Item struct {
	Text    string `json:"text"`
	Checked bool   `json:"checked"`
}

// Content is the complete editable note, with a fixed kind.
type Content struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Items []Item `json:"items"`
}

// Note is a private versioned document. Owner is never exposed to clients.
type Note struct {
	Content
	ID        string    `json:"id"`
	UserID    string    `json:"-"`
	Revision  int64     `json:"revision"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

var (
	ErrNotFound = errors.New("note not found")
	ErrConflict = errors.New("note revision changed")
)

// ValidationError contains field-level business errors.
type ValidationError struct{ Fields map[string]string }

func (e *ValidationError) Error() string { return "invalid note" }

// Repository persists entire documents atomically, scoped to a trusted owner.
type Repository interface {
	Create(context.Context, string, Content) (Note, error)
	Get(context.Context, string, string) (Note, error)
	List(context.Context, string) ([]Note, error)
	Replace(context.Context, string, string, int64, Content) (Note, error)
	Delete(context.Context, string, string, int64) error
}

// Service validates content independently of the transport.
type Service struct{ repository Repository }

// NewService assembles note use cases.
func NewService(r Repository) *Service { return &Service{r} }

// Create validates a new document before persistence.
func (s *Service) Create(ctx context.Context, owner string, c Content) (Note, error) {
	c, err := validate(c)
	if err != nil {
		return Note{}, err
	}
	return s.repository.Create(ctx, owner, c)
}

// Get returns only a document owned by this session.
func (s *Service) Get(ctx context.Context, owner, id string) (Note, error) {
	return s.repository.Get(ctx, owner, id)
}

// List returns all owned notes in repository order.
func (s *Service) List(ctx context.Context, owner string) ([]Note, error) {
	return s.repository.List(ctx, owner)
}

// Replace validates the full document; repository checks fixed kind and revision under lock.
func (s *Service) Replace(ctx context.Context, owner, id string, rev int64, c Content) (Note, error) {
	c, err := validate(c)
	if err != nil {
		return Note{}, err
	}
	return s.repository.Replace(ctx, owner, id, rev, c)
}

// Delete removes an owned document only when the client revision is current.
func (s *Service) Delete(ctx context.Context, owner, id string, rev int64) error {
	return s.repository.Delete(ctx, owner, id, rev)
}
func validate(c Content) (Content, error) {
	fields := map[string]string{}
	check := func(key, value string, min, max int) {
		if !utf8.ValidString(value) || strings.ContainsRune(value, 0) || utf8.RuneCountInString(value) < min || utf8.RuneCountInString(value) > max {
			fields[key] = "Недопустимая длина или символы."
		}
	}
	c.Title = strings.TrimSpace(c.Title)
	check("title", c.Title, 1, 200)
	check("body", c.Body, 0, 10000)
	if c.Items == nil {
		c.Items = []Item{}
	} else {
		c.Items = append(make([]Item, 0, len(c.Items)), c.Items...)
	}
	switch c.Kind {
	case "text":
		if len(c.Items) != 0 {
			fields["items"] = "У текстовой заметки нет пунктов."
		}
	case "checklist":
		if c.Body != "" {
			fields["body"] = "Используйте пункты списка."
		}
		if len(c.Items) < 1 || len(c.Items) > 100 {
			fields["items"] = "Добавьте от 1 до 100 пунктов."
		}
		for i := range c.Items {
			c.Items[i].Text = strings.TrimSpace(c.Items[i].Text)
			check("items", c.Items[i].Text, 1, 500)
		}
	default:
		fields["kind"] = "Выберите текст или чек-лист."
	}
	if len(fields) > 0 {
		return Content{}, &ValidationError{fields}
	}
	return c, nil
}
