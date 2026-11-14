// Package audit records who touched which record, never what it holds. A failed audit write fails the
// request: a reveal nobody can trace is worse than no reveal.
package audit

import (
	"context"
	"log/slog"

	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/storage"
)

// Caller is who is asking: the service its token belongs to, the ERP user it acts for, the request id.
type Caller struct {
	Service   string
	Actor     string
	RequestID string
}

type callerKey struct{}

func WithCaller(ctx context.Context, c Caller) context.Context {
	return context.WithValue(ctx, callerKey{}, c)
}

func CallerFrom(ctx context.Context) Caller {
	c, _ := ctx.Value(callerKey{}).(Caller)
	return c
}

// Log writes the audit row and a log line (owner ids only, no data).
type Log struct{ Store *storage.Store }

func (l Log) Record(ctx context.Context, action, ownerType, ownerID, outcome string) error {
	c := CallerFrom(ctx)
	slog.InfoContext(ctx, "vault", "action", action, "owner_type", ownerType, "owner_id", ownerID,
		"outcome", outcome, "service", c.Service, "actor", c.Actor, "request_id", c.RequestID)
	return l.Store.Audit(ctx, storage.AuditEntry{
		Service: c.Service, Actor: c.Actor, Action: action, OwnerType: ownerType, OwnerID: ownerID,
		Outcome: outcome, RequestID: c.RequestID,
	})
}
