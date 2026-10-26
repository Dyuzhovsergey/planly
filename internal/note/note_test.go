package note

import (
	"strings"
	"testing"
)

func TestContentRules(t *testing.T) {
	for _, c := range []Content{
		{Kind: "text", Title: "  Идея  ", Body: "<b>обычный текст</b>"},
		{Kind: "text", Title: "Empty list", Items: []Item{}},
		{Kind: "checklist", Title: "Список", Items: []Item{{Text: " Молоко ", Checked: true}}},
	} {
		got, err := validate(c)
		if err != nil || got.Title != strings.TrimSpace(c.Title) || got.Items == nil {
			t.Fatalf("%+v %v", got, err)
		}
	}
	for _, c := range []Content{
		{Kind: "text", Title: " "}, {Kind: "html", Title: "N"},
		{Kind: "text", Title: "N", Body: strings.Repeat("Я", 10001)},
		{Kind: "text", Title: "N", Items: []Item{{Text: "N"}}},
		{Kind: "checklist", Title: "N"},
		{Kind: "checklist", Title: "N", Items: []Item{{Text: " "}}},
		{Kind: "checklist", Title: "N", Items: []Item{{Text: "A"}}, Body: "x"},
		{Kind: "text", Title: "N\x00"}, {Kind: "text", Title: string([]byte{255})},
	} {
		if _, err := validate(c); err == nil {
			t.Fatalf("accepted invalid content %+v", c)
		}
	}
	items := []Item{{Text: " A "}}
	_, _ = validate(Content{Kind: "checklist", Title: "N", Items: items})
	if items[0].Text != " A " {
		t.Fatal("validation mutated caller draft")
	}
}
