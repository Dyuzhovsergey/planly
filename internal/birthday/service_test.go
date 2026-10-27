package birthday

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

const testID = "0199c471-a941-7b29-87af-59c00893d92c"

func intPointer(value int) *int          { return &value }
func stringPointer(value string) *string { return &value }

type memoryRepository struct {
	items []Birthday
	owner string
	calls int
	err   error
}

func (r *memoryRepository) Create(_ context.Context, owner string, p WriteParams) (Birthday, error) {
	r.calls++
	r.owner = owner
	if r.err != nil {
		return Birthday{}, r.err
	}
	v := Birthday{ID: testID, UserID: owner, Name: p.Name, Note: p.Note, Date: p.Date}
	r.items = append(r.items, v)
	return v, nil
}
func (r *memoryRepository) FindByID(_ context.Context, owner, id string) (Birthday, error) {
	r.calls++
	r.owner = owner
	if r.err != nil {
		return Birthday{}, r.err
	}
	for _, v := range r.items {
		if v.UserID == owner && v.ID == id {
			return v, nil
		}
	}
	return Birthday{}, ErrNotFound
}
func (r *memoryRepository) Update(ctx context.Context, owner, id string, fn UpdateFunc) (Birthday, error) {
	v, err := r.FindByID(ctx, owner, id)
	if err != nil {
		return Birthday{}, err
	}
	p, err := fn(v)
	if err != nil {
		return Birthday{}, err
	}
	v.Name, v.Note, v.Date = p.Name, p.Note, p.Date
	for i := range r.items {
		if r.items[i].ID == id && r.items[i].UserID == owner {
			r.items[i] = v
		}
	}
	return v, nil
}
func (r *memoryRepository) Delete(ctx context.Context, owner, id string) error {
	_, err := r.FindByID(ctx, owner, id)
	return err
}
func (r *memoryRepository) List(_ context.Context, owner string) ([]Birthday, error) {
	r.calls++
	r.owner = owner
	if r.err != nil {
		return nil, r.err
	}
	var items []Birthday
	for _, v := range r.items {
		if v.UserID == owner {
			items = append(items, v)
		}
	}
	return items, nil
}
func fixedService(r Repository) *Service {
	s := NewService(r)
	s.now = func() time.Time { return time.Date(2026, 10, 22, 0, 30, 0, 0, time.UTC) }
	return s
}
func mustDate(t *testing.T, month, day int, year *int) Date {
	t.Helper()
	d, err := NewDate(month, day, year)
	if err != nil {
		t.Fatal(err)
	}
	return d
}
func validationFields(t *testing.T, err error) map[string][]string {
	t.Helper()
	var validation *ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("expected validation error, got %v", err)
	}
	return validation.Fields
}

func TestDateValidation(t *testing.T) {
	for _, tc := range []struct {
		month, day int
		year       *int
		valid      bool
	}{
		{2, 29, nil, true}, {2, 29, intPointer(2000), true}, {2, 29, intPointer(1900), false},
		{2, 29, intPointer(2024), true}, {2, 29, intPointer(2023), false}, {4, 31, nil, false},
		{0, 1, nil, false}, {13, 1, nil, false}, {1, 0, nil, false}, {1, 32, nil, false},
		{1, 1, intPointer(0), false}, {1, 1, intPointer(-1), false}, {1, 1, intPointer(10000), false},
		{1, 1, intPointer(1), true}, {12, 31, intPointer(9999), true},
	} {
		value, err := NewDate(tc.month, tc.day, tc.year)
		if (err == nil) != tc.valid || (tc.valid && !value.Valid()) {
			t.Fatalf("%+v => %+v %v", tc, value, err)
		}
	}
	if (Date{}).Valid() {
		t.Fatal("zero date is valid")
	}
	d := mustDate(t, 2, 29, intPointer(2000))
	*d.BirthYear() = 2023
	if *d.BirthYear() != 2000 {
		t.Fatal("mutable year leaked")
	}
}

func TestCreateValidationAndAccountDate(t *testing.T) {
	r := &memoryRepository{}
	s := fixedService(r)
	ctx := context.Background()
	v, err := s.Create(ctx, "owner", "Asia/Tokyo", CreateInput{Name: "  Маша  ", Note: " заметка ", Month: 2, Day: 29})
	if err != nil || v.Name != "Маша" || v.Note != "заметка" || v.Date.BirthYear() != nil || r.owner != "owner" {
		t.Fatalf("%+v %v", v, err)
	}
	for _, tc := range []struct {
		input CreateInput
		field string
	}{
		{CreateInput{Name: " ", Month: 1, Day: 1}, "name"},
		{CreateInput{Name: strings.Repeat("я", 201), Month: 1, Day: 1}, "name"},
		{CreateInput{Name: "N\x00", Month: 1, Day: 1}, "name"},
		{CreateInput{Name: "N", Note: strings.Repeat("😀", 10001), Month: 1, Day: 1}, "note"},
		{CreateInput{Name: "N", Note: "\x00", Month: 1, Day: 1}, "note"},
		{CreateInput{Name: "N", Month: 4, Day: 31}, "day"},
		{CreateInput{Name: "N", Month: 2, Day: 29, BirthYear: intPointer(2023)}, "day"},
		{CreateInput{Name: "N", Month: 1, Day: 1, BirthYear: intPointer(10000)}, "birthYear"},
		{CreateInput{Name: "N", Month: 12, Day: 31, BirthYear: intPointer(2026)}, "birthYear"},
	} {
		before := r.calls
		_, err := s.Create(ctx, "owner", "UTC", tc.input)
		if validationFields(t, err)[tc.field] == nil || r.calls != before {
			t.Fatalf("input=%+v err=%v", tc.input, err)
		}
	}
	input := CreateInput{Name: strings.Repeat("😀", 200), Note: strings.Repeat("я", 10000), Month: 10, Day: 22, BirthYear: intPointer(2026)}
	if _, err := s.Create(ctx, "owner", "Asia/Tokyo", input); err != nil {
		t.Fatal(err)
	}
	_, err = s.Create(ctx, "owner", "America/Los_Angeles", input)
	if validationFields(t, err)["birthYear"] == nil {
		t.Fatal("future date in account zone accepted")
	}
	if _, err := s.Create(ctx, "owner", "Invalid/Zone", input); err == nil {
		t.Fatal("invalid trusted zone accepted")
	}
}

func TestUpdateMergesDateAndClearsYearAtomically(t *testing.T) {
	r := &memoryRepository{items: []Birthday{{ID: testID, UserID: "owner", Name: "Маша", Note: "note", Date: mustDate(t, 2, 29, intPointer(2000))}}}
	s := fixedService(r)
	ctx := context.Background()
	original := r.items[0]
	_, err := s.Update(ctx, "owner", "UTC", testID, UpdateInput{Name: stringPointer("Changed"), BirthYearSet: true, BirthYear: intPointer(2023)})
	validationFields(t, err)
	if !reflect.DeepEqual(original, r.items[0]) {
		t.Fatal("failed update changed data")
	}
	v, err := s.Update(ctx, "owner", "UTC", testID, UpdateInput{Note: stringPointer("  ")})
	if err != nil || v.Note != "" || *v.Date.BirthYear() != 2000 {
		t.Fatalf("preserve year: %+v %v", v, err)
	}
	v, err = s.Update(ctx, "owner", "UTC", testID, UpdateInput{BirthYearSet: true})
	if err != nil || v.Date.BirthYear() != nil || v.Date.Day() != 29 {
		t.Fatalf("clear year: %+v %v", v, err)
	}
	v, err = s.Update(ctx, "owner", "UTC", testID, UpdateInput{Day: intPointer(28), BirthYearSet: true, BirthYear: intPointer(2023)})
	if err != nil || v.Date.Day() != 28 || *v.Date.BirthYear() != 2023 {
		t.Fatalf("merged date: %+v %v", v, err)
	}
	_, err = s.Update(ctx, "owner", "UTC", testID, UpdateInput{})
	validationFields(t, err)
	for _, id := range []string{"bad", "", "0199c471a9417b2987af59c00893d92c"} {
		before := r.calls
		if _, err := s.GetByID(ctx, "owner", id); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		if _, err := s.Update(ctx, "owner", "UTC", id, UpdateInput{Name: stringPointer("x")}); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		if err := s.Delete(ctx, "owner", id); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		if r.calls != before {
			t.Fatal("malformed ID reached storage")
		}
	}
	if _, err := s.GetByID(ctx, "other", testID); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestOccurrencesLeapDatesAgeBoundariesAndOrdering(t *testing.T) {
	r := &memoryRepository{items: []Birthday{
		{ID: "b", UserID: "owner", Name: "Known", Date: mustDate(t, 2, 29, intPointer(2000))},
		{ID: "a", UserID: "owner", Name: "Unknown", Date: mustDate(t, 2, 29, nil)},
		{ID: "c", UserID: "owner", Name: "Edge", Date: mustDate(t, 3, 1, intPointer(1990))},
		{ID: "foreign", UserID: "other", Date: mustDate(t, 2, 28, nil)},
	}}
	s := fixedService(r)
	ctx := context.Background()
	items, err := s.Occurrences(ctx, "owner", RangeInput{"2027-02-28", "2028-02-29"})
	if err != nil || len(items) != 3 || items[0].BirthdayID != "a" || items[0].Age != nil || items[1].Date != "2027-02-28" || *items[1].Age != 27 || items[2].Date != "2027-03-01" {
		t.Fatalf("%+v %v", items, err)
	}
	items, err = s.Occurrences(ctx, "owner", RangeInput{"2028-02-29", "2028-03-01"})
	if err != nil || len(items) != 2 || *items[1].Age != 28 {
		t.Fatalf("%+v %v", items, err)
	}
	items, err = s.Occurrences(ctx, "owner", RangeInput{"2027-02-28", "2028-03-01"})
	// Exactly 367 days is invalid, even across a leap year.
	if err == nil || items != nil {
		t.Fatal("oversized range accepted")
	}
	items, err = s.Occurrences(ctx, "owner", RangeInput{"2026-02-28", "2027-03-01"})
	if err != nil || len(items) != 5 {
		t.Fatalf("two appearances per record lost: %+v %v", items, err)
	}
	items, err = s.Occurrences(ctx, "owner", RangeInput{"1999-02-28", "1999-03-01"})
	if err != nil || len(items) != 1 || items[0].Age != nil {
		t.Fatalf("prebirth: %+v %v", items, err)
	}
	items, err = s.Occurrences(ctx, "owner", RangeInput{"2000-02-29", "2000-03-01"})
	if err != nil || len(items) != 2 || *items[1].Age != 0 {
		t.Fatalf("birth year: %+v %v", items, err)
	}
	for _, input := range []RangeInput{{"", ""}, {"2026-02-30", "2026-03-02"}, {"0000-01-01", "0001-01-01"}, {"9999-12-31", "10000-01-01"}, {"2026-01-01", "2026-01-01"}, {"2026-01-02", "2026-01-01"}} {
		before := r.calls
		_, err := s.Occurrences(ctx, "owner", input)
		validationFields(t, err)
		if r.calls != before {
			t.Fatal("invalid range reached storage")
		}
	}
	items, err = s.Occurrences(ctx, "owner", RangeInput{"9999-02-28", "9999-03-01"})
	if err != nil || len(items) != 2 || *items[1].Age != 7999 {
		t.Fatalf("maximum year: %+v %v", items, err)
	}
	items, err = s.Occurrences(ctx, "other", RangeInput{"0001-01-01", "0001-01-02"})
	if err != nil || items == nil || len(items) != 0 {
		t.Fatalf("empty list: %+v %v", items, err)
	}
}

func TestRepositoryErrorsPropagate(t *testing.T) {
	want := errors.New("storage unavailable")
	r := &memoryRepository{err: want}
	s := fixedService(r)
	ctx := context.Background()
	_, a := s.Create(ctx, "owner", "UTC", CreateInput{Name: "N", Month: 1, Day: 1})
	_, b := s.GetByID(ctx, "owner", testID)
	_, c := s.Update(ctx, "owner", "UTC", testID, UpdateInput{Name: stringPointer("N")})
	d := s.Delete(ctx, "owner", testID)
	_, e := s.List(ctx, "owner")
	_, f := s.Occurrences(ctx, "owner", RangeInput{"2026-01-01", "2026-01-02"})
	for _, err := range []error{a, b, c, d, e, f} {
		if !errors.Is(err, want) {
			t.Fatalf("%v", err)
		}
	}
}
