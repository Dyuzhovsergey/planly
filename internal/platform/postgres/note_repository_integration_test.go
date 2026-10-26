package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/note"
)

func TestNoteRepositoryIntegration(t *testing.T) {
	url := os.Getenv("PLANLY_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PLANLY_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	suffix := time.Now().UnixNano()
	emails := []string{fmt.Sprintf("notes-owner-%d@example.com", suffix), fmt.Sprintf("notes-other-%d@example.com", suffix)}
	defer func() {
		_, err := pool.Exec(context.Background(), `DELETE FROM users WHERE email=ANY($1)`, emails)
		if err != nil {
			t.Error(err)
		}
	}()
	owner := insertTaskTestUser(t, ctx, pool, emails[0])
	other := insertTaskTestUser(t, ctx, pool, emails[1])
	r := NewNoteRepository(pool)
	s := note.NewService(r)
	c := note.Content{Kind: "checklist", Title: "Покупки", Items: []note.Item{{Text: "A"}, {Text: "B"}}}
	n, err := s.Create(ctx, owner, c)
	if err != nil {
		t.Fatal(err)
	}
	if n.Revision != 1 || len(n.Items) != 2 || n.CreatedAt.IsZero() {
		t.Fatalf("bad note %+v", n)
	}
	for _, id := range []string{n.ID, "malformed"} {
		if _, err := s.Get(ctx, other, id); !errors.Is(err, note.ErrNotFound) {
			t.Fatalf("foreign read: %v", err)
		}
		if _, err := s.Replace(ctx, other, id, 1, c); !errors.Is(err, note.ErrNotFound) {
			t.Fatalf("foreign update: %v", err)
		}
		if err := s.Delete(ctx, other, id, 1); !errors.Is(err, note.ErrNotFound) {
			t.Fatalf("foreign delete: %v", err)
		}
	}
	list, err := s.List(ctx, other)
	if err != nil || len(list) != 0 {
		t.Fatal("foreign list")
	}
	c.Items[0].Checked = true
	c.Items = c.Items[:1]
	changed, err := s.Replace(ctx, owner, n.ID, 1, c)
	if err != nil || changed.Revision != 2 || len(changed.Items) != 1 || !changed.Items[0].Checked {
		t.Fatalf("replace %+v %v", changed, err)
	}
	if _, err := s.Replace(ctx, owner, n.ID, 1, c); !errors.Is(err, note.ErrConflict) {
		t.Fatal("stale replacement accepted")
	}
	if err := s.Delete(ctx, owner, n.ID, 1); !errors.Is(err, note.ErrConflict) {
		t.Fatal("stale delete accepted")
	}
	if _, err := s.Replace(ctx, owner, n.ID, 2, note.Content{Kind: "text", Title: "N"}); err == nil {
		t.Fatal("kind changed")
	}
	// Concurrent full-document replacements cannot both succeed from one revision.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.Replace(ctx, owner, n.ID, 2, c); results <- err }()
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, note.ErrConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("concurrent writes: %d/%d", success, conflict)
	}
	got, err := s.Get(ctx, owner, n.ID)
	if err != nil || got.Revision != 3 {
		t.Fatalf("persist %+v %v", got, err)
	}
	text, err := s.Create(ctx, owner, note.Content{Kind: "text", Title: "Текст", Body: "Много\nстрок"})
	if err != nil {
		t.Fatal(err)
	}
	list, err = s.List(ctx, owner)
	if err != nil || len(list) != 2 || list[0].ID != text.ID {
		t.Fatalf("order %+v %v", list, err)
	}
	if err := s.Delete(ctx, owner, n.ID, 3); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, owner, n.ID); !errors.Is(err, note.ErrNotFound) {
		t.Fatal("deleted note visible")
	}
}
