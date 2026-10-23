package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/birthday"
)

func birthdayDate(t *testing.T, month, day int, year *int) birthday.Date {
	t.Helper()
	d, err := birthday.NewDate(month, day, year)
	if err != nil {
		t.Fatal(err)
	}
	return d
}
func birthdayYear(y int) *int { return &y }
func unchangedBirthday(v birthday.Birthday) birthday.WriteParams {
	return birthday.WriteParams{Name: v.Name, Note: v.Note, Date: v.Date}
}

func TestBirthdayRepositoryIntegration(t *testing.T) {
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
	emails := []string{fmt.Sprintf("birthday-owner-%d@example.com", suffix), fmt.Sprintf("birthday-other-%d@example.com", suffix)}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if _, err := pool.Exec(cleanup, `DELETE FROM users WHERE email=ANY($1)`, emails); err != nil {
			t.Errorf("cleanup birthday fixtures: %v", err)
		}
	}()
	owner := insertTaskTestUser(t, ctx, pool, emails[0])
	other := insertTaskTestUser(t, ctx, pool, emails[1])
	r := NewBirthdayRepository(pool)
	original, err := r.Create(ctx, owner, birthday.WriteParams{Name: "Маша", Note: "Заметка", Date: birthdayDate(t, 2, 29, birthdayYear(2000))})
	if err != nil {
		t.Fatal(err)
	}
	if original.ID == "" || original.UserID != owner || original.CreatedAt.IsZero() || original.UpdatedAt.IsZero() {
		t.Fatalf("bad metadata: %+v", original)
	}
	got, err := r.FindByID(ctx, owner, original.ID)
	if err != nil || !reflect.DeepEqual(got, original) {
		t.Fatalf("roundtrip: %+v %v", got, err)
	}
	for _, tc := range []struct{ owner, id string }{{other, original.ID}, {owner, "00000000-0000-0000-0000-000000000000"}, {owner, "bad"}, {owner, ""}} {
		if _, err := r.FindByID(ctx, tc.owner, tc.id); !errors.Is(err, birthday.ErrNotFound) {
			t.Fatalf("get isolation: %v", err)
		}
		if _, err := r.Update(ctx, tc.owner, tc.id, func(v birthday.Birthday) (birthday.WriteParams, error) {
			t.Error("callback reached foreign row")
			return unchangedBirthday(v), nil
		}); !errors.Is(err, birthday.ErrNotFound) {
			t.Fatalf("update isolation: %v", err)
		}
		if err := r.Delete(ctx, tc.owner, tc.id); !errors.Is(err, birthday.ErrNotFound) {
			t.Fatalf("delete isolation: %v", err)
		}
	}
	want := errors.New("validation failed")
	if _, err := r.Update(ctx, owner, original.ID, func(v birthday.Birthday) (birthday.WriteParams, error) { return birthday.WriteParams{}, want }); !errors.Is(err, want) {
		t.Fatal(err)
	}
	if _, err := r.Update(ctx, owner, original.ID, func(v birthday.Birthday) (birthday.WriteParams, error) {
		p := unchangedBirthday(v)
		p.Name = ""
		return p, nil
	}); !isCheckViolation(err) {
		t.Fatalf("DB rollback: %v", err)
	}
	preserved, err := r.FindByID(ctx, owner, original.ID)
	if err != nil || !reflect.DeepEqual(original, preserved) {
		t.Fatalf("rejected update changed row: %+v %v", preserved, err)
	}
	updated, err := r.Update(ctx, owner, original.ID, func(v birthday.Birthday) (birthday.WriteParams, error) {
		return birthday.WriteParams{Name: v.Name, Date: birthdayDate(t, 2, 29, nil)}, nil
	})
	if err != nil || updated.Note != "" || updated.Date.BirthYear() != nil || !updated.CreatedAt.Equal(original.CreatedAt) || !updated.UpdatedAt.After(original.UpdatedAt) {
		t.Fatalf("update: %+v %v", updated, err)
	}
	// Both callbacks must observe the previous committed name. No lost partial updates.
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := r.Update(ctx, owner, original.ID, func(v birthday.Birthday) (birthday.WriteParams, error) {
				p := unchangedBirthday(v)
				p.Name += "!"
				time.Sleep(15 * time.Millisecond)
				return p, nil
			})
			if err != nil {
				t.Errorf("concurrent update: %v", err)
			}
		}()
	}
	wg.Wait()
	updated, err = r.FindByID(ctx, owner, original.ID)
	if err != nil || updated.Name != "Маша!!" {
		t.Fatalf("lost update: %+v %v", updated, err)
	}
	if _, err := r.Create(ctx, owner, birthday.WriteParams{Name: "Invalid"}); !errors.Is(err, birthday.ErrInvalidDate) {
		t.Fatal(err)
	}
	// Exercise database constraints directly, including known/unknown leap years.
	for _, args := range [][]any{{"N", 0, 1, nil, ""}, {"N", 13, 1, nil, ""}, {"N", 4, 31, nil, ""}, {"N", 2, 29, 1900, ""}, {"N", 1, 1, 0, ""}, {"N", 1, 1, 10000, ""}, {" ", 1, 1, nil, ""}} {
		_, err := pool.Exec(ctx, `INSERT INTO birthdays(user_id,name,month,day,birth_year,note) VALUES ($1,$2,$3,$4,$5,$6)`, owner, args[0], args[1], args[2], args[3], args[4])
		if !isCheckViolation(err) {
			t.Fatalf("constraints %v: %v", args, err)
		}
	}
	// Duplicate people/dates remain independent records; sorting uses ID for ties.
	for _, date := range []birthday.Date{birthdayDate(t, 12, 31, nil), birthdayDate(t, 1, 1, nil), birthdayDate(t, 2, 29, nil)} {
		if _, err := r.Create(ctx, owner, birthday.WriteParams{Name: "Same", Date: date}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := r.Create(ctx, other, birthday.WriteParams{Name: "Foreign", Date: birthdayDate(t, 1, 1, nil)}); err != nil {
		t.Fatal(err)
	}
	items, err := r.List(ctx, owner)
	if err != nil || len(items) != 4 {
		t.Fatalf("list: %v %v", items, err)
	}
	for i, v := range items {
		if v.UserID != owner {
			t.Fatal("list leaked owner")
		}
		if i > 0 {
			a, b := items[i-1], v
			if a.Date.Month() > b.Date.Month() || (a.Date.Month() == b.Date.Month() && (a.Date.Day() > b.Date.Day() || (a.Date.Day() == b.Date.Day() && a.ID > b.ID))) {
				t.Fatal("unstable order")
			}
		}
	}
	cancelled, stop := context.WithCancel(ctx)
	stop()
	if _, err := r.List(cancelled, owner); !errors.Is(err, context.Canceled) {
		t.Fatalf("context: %v", err)
	}
	if err := r.Delete(ctx, owner, original.ID); err != nil {
		t.Fatal(err)
	}
	if err := r.Delete(ctx, owner, original.ID); !errors.Is(err, birthday.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := r.FindByID(ctx, owner, original.ID); !errors.Is(err, birthday.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, owner); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM birthdays WHERE user_id=$1`, owner).Scan(&count); err != nil || count != 0 {
		t.Fatalf("cascade: %d %v", count, err)
	}
}
