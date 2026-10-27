package birthday

import "context"

// WriteParams holds a complete validated source record, without its owner or ID.
type WriteParams struct {
	Name, Note string
	Date       Date
}

// UpdateFunc validates a partial change against the latest locked source record.
// It must be quick and perform no I/O. Returning an error leaves the row unchanged.
type UpdateFunc func(Birthday) (WriteParams, error)

// Repository scopes every operation to a separately supplied trusted owner.
type Repository interface {
	Create(context.Context, string, WriteParams) (Birthday, error)
	FindByID(context.Context, string, string) (Birthday, error)
	// Update serializes read/validate/write so omitted date fields cannot be lost.
	Update(context.Context, string, string, UpdateFunc) (Birthday, error)
	Delete(context.Context, string, string) error
	// List returns all owned source records ordered by month, day and ID.
	List(context.Context, string) ([]Birthday, error)
}
