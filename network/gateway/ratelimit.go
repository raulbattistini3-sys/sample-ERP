package gateway

import (
	"math"
	"sync"
	"time"
)

// Limiter is a per-client token bucket (ported from the launcher's Rust gateway): rate tokens per second,
// up to burst. It caps how fast any one client is served, turning a flood away with 429 before it reaches
// the API and the database.
type Limiter struct {
	rate  float64 // <= 0 disables limiting
	burst float64

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

func NewLimiter(rate float64, burst int) *Limiter {
	return &Limiter{rate: rate, burst: float64(max(burst, 1)), buckets: map[string]*bucket{}}
}

// Allow spends one token for key; when none is left it returns how long until one is.
func (l *Limiter) Allow(key string, now time.Time) (bool, time.Duration) {
	if l.rate <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets[key]
	if !ok {
		// a fresh client starts full, then spends one
		l.buckets[key] = &bucket{tokens: l.burst - 1, last: now}
		return true, 0
	}
	b.tokens = math.Min(b.tokens+now.Sub(b.last).Seconds()*l.rate, l.burst)
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	// rounded up, so Retry-After is never 0 while still denied
	return false, time.Duration((1-b.tokens)/l.rate*float64(time.Second)) + time.Millisecond
}

// GC drops buckets that had time to refill completely (a new one starts full anyway).
func (l *Limiter) GC(now time.Time) {
	if l.rate <= 0 {
		return
	}
	cutoff := max(time.Duration(l.burst/l.rate*float64(time.Second)), time.Minute)
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, b := range l.buckets {
		if now.Sub(b.last) >= cutoff {
			delete(l.buckets, k)
		}
	}
}
