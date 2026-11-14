// Package logx is the network service's structured log: one JSON object per line on stdout (or readable
// text in development), always carrying the service name and instance id, and never the parts of a request
// that identify a person or what they typed.
//
// The query string is dropped from every logged path (searches are typed there, and the telemetry that
// feeds the ERP's predictor must not learn them), and the headers that carry credentials are never logged.
// The client address is kept, because rate limits and blocks act on it.
package logx

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

type ctxKey struct{}

// Options picks the format and level. Format "json" (the default) or "text".
type Options struct {
	Service  string
	Instance string
	Format   string
	Level    slog.Level
	Out      io.Writer
}

// New builds the root logger and makes it slog's default, so packages that call slog directly log the
// same way.
func New(o Options) *slog.Logger {
	out := o.Out
	if out == nil {
		out = os.Stdout
	}
	ho := &slog.HandlerOptions{Level: o.Level, ReplaceAttr: redact}
	var h slog.Handler
	if strings.EqualFold(o.Format, "text") {
		h = slog.NewTextHandler(out, ho)
	} else {
		h = slog.NewJSONHandler(out, ho)
	}
	l := slog.New(h).With("service", o.Service, "instance", o.Instance)
	slog.SetDefault(l)
	return l
}

// ParseLevel reads "debug", "info", "warn" or "error"; anything else is info.
func ParseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	}
	return slog.LevelInfo
}

// keys whose values are never written, whatever logged them
var secret = map[string]bool{
	"authorization": true, "cookie": true, "set-cookie": true, "token": true, "secret": true,
	"password": true, "x-recaptcha-token": true, "x-network-signature": true, "idempotency-key": true,
}

func redact(_ []string, a slog.Attr) slog.Attr {
	if secret[strings.ToLower(a.Key)] {
		return slog.String(a.Key, "[redacted]")
	}
	return a
}

// With returns ctx carrying l; From reads it back (the default logger when there is none).
func With(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, ctxKey{}, l)
}

func From(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(ctxKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// Path is r's path without the query string.
func Path(r *http.Request) string {
	return r.URL.Path
}

// Request is the access log line for one request: method, path (no query), status, bytes, time taken,
// which service and instance answered, and why the network answered itself when it did ("rate_limited",
// "captcha", "deduplicated", ...).
func Request(l *slog.Logger, r *http.Request, client string, status int, bytes int64, took time.Duration, attrs ...slog.Attr) {
	level := slog.LevelInfo
	switch {
	case status >= 500:
		level = slog.LevelError
	case status >= 400:
		level = slog.LevelWarn
	}
	base := []slog.Attr{
		slog.String("method", r.Method),
		slog.String("path", Path(r)),
		slog.Int("status", status),
		slog.Int64("bytes", bytes),
		slog.Float64("ms", float64(took.Microseconds())/1000),
		slog.String("client", client),
	}
	l.LogAttrs(r.Context(), level, "request", append(base, attrs...)...)
}
