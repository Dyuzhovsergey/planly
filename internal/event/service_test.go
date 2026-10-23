package event

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

const serviceTestID = "0199c471-a941-7b29-87af-59c00893d92c"

type serviceRepository struct {
	owner, id string
	calls     int
	create    CreateParams
	update    UpdateParams
	bounds    ListRange
	result    Event
	list      []Event
	err       error
}

func (r *serviceRepository) Create(_ context.Context, owner string, p CreateParams) (Event, error) {
	r.calls++
	r.owner = owner
	r.create = p
	return r.result, r.err
}
func (r *serviceRepository) FindByID(_ context.Context, owner, id string) (Event, error) {
	r.calls++
	r.owner = owner
	r.id = id
	return r.result, r.err
}
func (r *serviceRepository) Update(_ context.Context, owner, id string, p UpdateParams) (Event, error) {
	r.calls++
	r.owner = owner
	r.id = id
	r.update = p
	return r.result, r.err
}
func (r *serviceRepository) Delete(_ context.Context, owner, id string) error {
	r.calls++
	r.owner = owner
	r.id = id
	return r.err
}
func (r *serviceRepository) ListByRange(_ context.Context, owner string, p ListRange) ([]Event, error) {
	r.calls++
	r.owner = owner
	r.bounds = p
	return r.list, r.err
}
func eventString(value string) *string { return &value }
func serviceSchedule() ScheduleInput {
	return ScheduleInput{Type: "timed", Start: eventString("2026-10-22T15:00:00+03:00"), End: eventString("2026-10-22T16:00:00+03:00")}
}
func requireEventValidation(t *testing.T, err error, field string) {
	t.Helper()
	var validation *ValidationError
	if !errors.As(err, &validation) || len(validation.Fields[field]) == 0 {
		t.Fatalf("error=%v, want validation for %s", err, field)
	}
}

func TestServiceCreateAndUpdate(t *testing.T) {
	ctx := context.Background()
	r := &serviceRepository{result: Event{ID: serviceTestID}}
	s := NewService(r)
	created, err := s.Create(ctx, "owner", CreateInput{Title: "  Встреча  ", Description: " notes\n", Location: " cafe ", Link: " https://example.com/path?q=x ", Schedule: serviceSchedule()})
	if err != nil || created.ID != serviceTestID || r.owner != "owner" || r.create.Title != "Встреча" || r.create.Description != "notes" || r.create.Location != "cafe" || r.create.Link != "https://example.com/path?q=x" {
		t.Fatalf("create=%+v err=%v", r, err)
	}
	start, end, ok := r.create.Schedule.Times()
	if !ok || start.Hour() != 12 || end.Hour() != 13 || start.Location() != time.UTC {
		t.Fatal("not normalized to UTC")
	}
	allDay := ScheduleInput{Type: "allDay", StartDate: eventString("2026-12-31"), EndDate: eventString("2027-01-02")}
	_, err = s.Update(ctx, "owner", serviceTestID, UpdateInput{Title: eventString(" new "), Description: eventString("  "), Location: eventString(""), Link: eventString(""), Schedule: &allDay})
	if err != nil || r.id != serviceTestID || *r.update.Title != "new" || *r.update.Description != "" || *r.update.Link != "" || *r.update.Location != "" {
		t.Fatalf("update=%+v err=%v", r.update, err)
	}
	a, b, ok := r.update.Schedule.Dates()
	if !ok || a.String() != "2026-12-31" || b.String() != "2027-01-02" {
		t.Fatal("all-day interval changed")
	}
	_, err = s.Update(ctx, "owner", serviceTestID, UpdateInput{Description: eventString("only")})
	if err != nil || r.update.Title != nil || r.update.Schedule != nil {
		t.Fatal("omitted fields changed")
	}
}

func TestServiceRejectsInvalidTextBeforeStorage(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*CreateInput)
		field  string
	}{
		{"blank", func(p *CreateInput) { p.Title = " \n " }, "title"},
		{"long unicode", func(p *CreateInput) { p.Title = strings.Repeat("я", 201) }, "title"},
		{"NUL title", func(p *CreateInput) { p.Title = "x\x00" }, "title"},
		{"long description", func(p *CreateInput) { p.Description = strings.Repeat("я", 10001) }, "description"},
		{"NUL description", func(p *CreateInput) { p.Description = "x\x00" }, "description"},
		{"long location", func(p *CreateInput) { p.Location = strings.Repeat("x", 501) }, "location"},
		{"long link", func(p *CreateInput) { p.Link = "https://example.com/" + strings.Repeat("x", 2048) }, "link"},
		{"relative link", func(p *CreateInput) { p.Link = "/local" }, "link"},
		{"unsafe scheme", func(p *CreateInput) { p.Link = "javascript:alert(1)" }, "link"},
		{"credentials", func(p *CreateInput) { p.Link = "https://user:pass@example.com" }, "link"},
		{"space", func(p *CreateInput) { p.Link = "https://example.com/a b" }, "link"},
		{"control", func(p *CreateInput) { p.Link = "https://example.com/a\x01b" }, "link"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := &serviceRepository{}
			p := CreateInput{Title: "Valid", Schedule: serviceSchedule()}
			tc.change(&p)
			_, err := NewService(r).Create(context.Background(), "owner", p)
			requireEventValidation(t, err, tc.field)
			if r.calls != 0 {
				t.Fatal("invalid input reached storage")
			}
		})
	}
	r := &serviceRepository{}
	_, err := NewService(r).Create(context.Background(), "owner", CreateInput{Title: strings.Repeat("я", 200), Description: strings.Repeat("я", 10000), Location: strings.Repeat("я", 500), Schedule: serviceSchedule()})
	if err != nil {
		t.Fatalf("valid Unicode limits: %v", err)
	}
}

func TestServiceRejectsInvalidSchedules(t *testing.T) {
	for _, tc := range []struct {
		name, field string
		input       ScheduleInput
	}{
		{"missing type", "schedule.type", ScheduleInput{}},
		{"missing start", "schedule.start", ScheduleInput{Type: "timed", End: eventString("2026-01-01T00:00:00Z")}},
		{"missing end", "schedule.end", ScheduleInput{Type: "timed", Start: eventString("2026-01-01T00:00:00Z")}},
		{"missing offset", "schedule.start", ScheduleInput{Type: "timed", Start: eventString("2026-01-01T00:00:00"), End: eventString("2026-01-02T00:00:00Z")}},
		{"comma fraction", "schedule.start", ScheduleInput{Type: "timed", Start: eventString("2026-01-01T00:00:00,5Z"), End: eventString("2026-01-02T00:00:00Z")}},
		{"offset 24", "schedule.start", ScheduleInput{Type: "timed", Start: eventString("2026-01-01T00:00:00+24:00"), End: eventString("2026-01-02T00:00:00Z")}},
		{"year zero offset", "schedule.start", ScheduleInput{Type: "timed", Start: eventString("0000-12-31T23:00:00-02:00"), End: eventString("0001-01-02T00:00:00Z")}},
		{"equal", "schedule.end", ScheduleInput{Type: "timed", Start: eventString("2026-01-01T00:00:00Z"), End: eventString("2026-01-01T00:00:00Z")}},
		{"mixed empty date", "schedule.startDate", ScheduleInput{Type: "timed", Start: eventString("2026-01-01T00:00:00Z"), End: eventString("2026-01-02T00:00:00Z"), StartDate: eventString("")}},
		{"all-day missing end", "schedule.endDate", ScheduleInput{Type: "allDay", StartDate: eventString("2026-01-01")}},
		{"all-day impossible", "schedule.startDate", ScheduleInput{Type: "allDay", StartDate: eventString("2026-02-29"), EndDate: eventString("2026-03-01")}},
		{"all-day reverse", "schedule.endDate", ScheduleInput{Type: "allDay", StartDate: eventString("2026-02-02"), EndDate: eventString("2026-02-01")}},
		{"all-day mixed empty time", "schedule.start", ScheduleInput{Type: "allDay", StartDate: eventString("2026-02-01"), EndDate: eventString("2026-02-02"), Start: eventString("")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := &serviceRepository{}
			_, err := NewService(r).Create(context.Background(), "owner", CreateInput{Title: "Valid", Schedule: tc.input})
			requireEventValidation(t, err, tc.field)
			if r.calls > 0 {
				t.Fatal("invalid schedule reached storage")
			}
		})
	}
}

func TestServiceUpdateValidationAndRepositoryErrors(t *testing.T) {
	ctx := context.Background()
	r := &serviceRepository{}
	s := NewService(r)
	_, err := s.Update(ctx, "owner", serviceTestID, UpdateInput{})
	requireEventValidation(t, err, "body")
	_, err = s.Update(ctx, "owner", serviceTestID, UpdateInput{Title: eventString("valid"), Link: eventString("file:///etc/passwd")})
	requireEventValidation(t, err, "link")
	if r.calls > 0 {
		t.Fatal("invalid update reached storage")
	}
	for _, id := range []string{"bad", "00000000000000000000000000000000", "0199c471-a941-7b29-87af-59c00893d92g"} {
		if _, err := s.GetByID(ctx, "owner", id); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		if _, err := s.Update(ctx, "owner", id, UpdateInput{Title: eventString("valid")}); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		if err := s.Delete(ctx, "owner", id); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
	}
	if r.calls > 0 {
		t.Fatal("invalid ID reached storage")
	}
	for _, failure := range []error{ErrNotFound, errors.New("repository failed")} {
		r.err = failure
		operations := []func() error{
			func() error {
				_, err := s.Create(ctx, "trusted", CreateInput{Title: "valid", Schedule: serviceSchedule()})
				return err
			},
			func() error { _, err := s.GetByID(ctx, "trusted", serviceTestID); return err },
			func() error {
				_, err := s.Update(ctx, "trusted", serviceTestID, UpdateInput{Title: eventString("valid")})
				return err
			},
			func() error { return s.Delete(ctx, "trusted", serviceTestID) },
			func() error {
				_, err := s.List(ctx, "trusted", "UTC", ListInput{From: "2026-01-01", To: "2026-02-01"})
				return err
			},
		}
		for _, op := range operations {
			if err := op(); !errors.Is(err, failure) || r.owner != "trusted" {
				t.Fatalf("lost owner/error: %v %s", err, r.owner)
			}
		}
	}
}

func TestServiceCalendarRangeResolution(t *testing.T) {
	for _, tc := range []struct{ zone, from, to, start, end string }{
		{"Europe/Berlin", "2026-03-29", "2026-03-30", "2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z"},
		{"Europe/Berlin", "2026-10-25", "2026-10-26", "2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z"},
		{"America/Sao_Paulo", "2018-11-04", "2018-11-05", "2018-11-04T03:00:00Z", "2018-11-05T02:00:00Z"},
		{"America/Havana", "2020-11-01", "2020-11-02", "2020-11-01T04:00:00Z", "2020-11-02T05:00:00Z"},
		{"Pacific/Apia", "2011-12-30", "2011-12-31", "2011-12-30T10:00:00Z", "2011-12-30T10:00:00Z"},
	} {
		t.Run(tc.zone+tc.from, func(t *testing.T) {
			r := &serviceRepository{}
			_, err := NewService(r).List(context.Background(), "owner", tc.zone, ListInput{From: tc.from, To: tc.to})
			if err != nil {
				t.Fatal(err)
			}
			if r.bounds.FromTime.Format(time.RFC3339) != tc.start || r.bounds.ToTime.Format(time.RFC3339) != tc.end || r.bounds.FromDate.String() != tc.from || r.bounds.TimeZone != tc.zone {
				t.Fatalf("resolved bounds: %+v", r.bounds)
			}
			if err := r.bounds.Validate(); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, input := range []ListInput{{}, {From: "2026-02-29", To: "2026-03-01"}, {From: "2026-01-01", To: "2026-01-01"}, {From: "2027-01-01", To: "2026-01-01"}, {From: "2026-01-01", To: "2027-01-03"}} {
		r := &serviceRepository{}
		_, err := NewService(r).List(context.Background(), "owner", "UTC", input)
		var validation *ValidationError
		if !errors.As(err, &validation) || r.calls != 0 {
			t.Fatalf("invalid range accepted: %+v %v", input, err)
		}
	}
	r := &serviceRepository{}
	_, err := NewService(r).List(context.Background(), "owner", "invalid/zone", ListInput{From: "2026-01-01", To: "2026-01-02"})
	if err == nil || r.calls > 0 {
		t.Fatal("invalid trusted zone accepted")
	}
	_, err = NewService(r).List(context.Background(), "owner", "UTC", ListInput{From: "2028-01-01", To: "2029-01-01"})
	if err != nil || !reflect.DeepEqual(r.bounds.FromDate, CalendarDate{value: "2028-01-01"}) {
		t.Fatal("366-day leap-year range rejected")
	}
}
