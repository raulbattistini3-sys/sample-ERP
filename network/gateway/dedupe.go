package gateway

import (
	"context"
	"sync"
	"time"
)

// Dedupe absorbs double clicks: a second identical mutating request (same caller, method, path, query and
// body) that arrives while the first is still running, or within Window after it answered, is not sent to
// the service again. It waits for the first and gets a copy of its response, marked
// X-Network-Deduplicated: true. Unlike Idempotency-Key, it needs nothing from the client: it covers
// every POST/PUT/PATCH/DELETE, including the forms that never sent a key.
//
// Identical means byte-identical: two clicks that save different values are two different requests and
// both run.
type Dedupe struct {
	Window time.Duration

	mu      sync.Mutex
	flights map[string]*flight
}

type flight struct {
	done chan struct{}
	res  *stored // nil: the first failed or its response was too big to copy
	// the copy is served until then (zero while running)
	until time.Time
	// sensitive answers (session tokens) are shared only with requests that arrived while running
	keep bool
}

func NewDedupe(window time.Duration) *Dedupe {
	return &Dedupe{Window: window, flights: map[string]*flight{}}
}

// join returns the flight for key and whether the caller leads it (runs the request).
func (d *Dedupe) join(key string, now time.Time) (*flight, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if f, ok := d.flights[key]; ok && (f.until.IsZero() || now.Before(f.until)) {
		return f, false
	}
	f := &flight{done: make(chan struct{})}
	d.flights[key] = f
	return f, true
}

// finish publishes the leader's response; keep=false serves it only to the requests already waiting.
func (d *Dedupe) finish(key string, f *flight, res *stored, keep bool, now time.Time) {
	d.mu.Lock()
	f.res, f.keep = res, keep
	if keep && res != nil {
		f.until = now.Add(d.Window)
	} else {
		f.until = now
		if d.flights[key] == f {
			delete(d.flights, key)
		}
	}
	d.mu.Unlock()
	close(f.done)
}

// wait blocks until the leader answered (or ctx ends).
func (f *flight) wait(ctx context.Context) (*stored, error) {
	select {
	case <-f.done:
		return f.res, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (d *Dedupe) GC(now time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for k, f := range d.flights {
		if !f.until.IsZero() && now.After(f.until) {
			delete(d.flights, k)
		}
	}
}
