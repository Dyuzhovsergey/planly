// Package migrations exposes Planly's embedded SQL migrations.
package migrations

import "embed"

// FS contains the SQL migrations used by the migration command.
//
//go:embed *.sql
var FS embed.FS
