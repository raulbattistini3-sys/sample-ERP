package gateway

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

// Idempotency-Key handling, ported from the launcher's Rust gateway (itself from orderguard): the first
// request with a key runs; a concurrent duplicate gets 409 while it is in flight and the stored response
// (marked Idempotent-Replayed) once it's done. The same key with a different method, path or body is 422:
// the tampered replay a man in the middle would try. A 5xx frees the key, so a retry runs again.

const (
	idempotencyHeader = "Idempotency-Key"
	replayedHeader    = "Idempotent-Replayed"
	idempotencyTTL    = 24 * time.Hour
	// past this an in-flight key is considered lost, and a retry takes it over
	lockTimeout = 10 * time.Minute
	// responses bigger than this aren't kept for replay
	maxStoredBody = 1 << 20
)

func validKey(k string) bool {
	if len(k) < 8 || len(k) > 255 {
		return false
	}
	for i := 0; i < len(k); i++ {
		c := k[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '.' || c == ':' || c == '-') {
			return false
		}
	}
	return true
}

// fingerprint is the sha256 of what a key promises to repeat: method, path with query, body.
func fingerprint(method, uri string, body []byte) [32]byte {
	h := sha256.New()
	h.Write([]byte(method))
	h.Write([]byte{0})
	h.Write([]byte(uri))
	h.Write([]byte{0})
	h.Write(body)
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// scoped puts keys in the caller's namespace (a hash of its Authorization header), so one user can
// neither block another's key nor read the response stored under it.
func scoped(owner, key string) string {
	sum := sha256.Sum256([]byte(owner))
	return hex.EncodeToString(sum[:]) + ":" + key
}

// stored is a response kept for replay.
type stored struct {
	status int
	header http.Header
	body   []byte // nil when it was too big to keep
}

type acquire int

const (
	owner acquire = iota
	inFlight
	mismatch
	replay
)

type idemRecord struct {
	fp      [32]byte
	pending bool
	since   time.Time
	created time.Time
	res     *stored
}

type IdempotencyStore struct {
	mu      sync.Mutex
	records map[string]*idemRecord
}

func NewIdempotencyStore() *IdempotencyStore {
	return &IdempotencyStore{records: map[string]*idemRecord{}}
}

func (s *IdempotencyStore) acquire(key string, fp [32]byte, now time.Time) (acquire, *stored) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.records[key]; ok {
		stale := (r.pending && now.Sub(r.since) > lockTimeout) || now.Sub(r.created) > idempotencyTTL
		if !stale {
			switch {
			case r.fp != fp:
				return mismatch, nil
			case r.pending:
				return inFlight, nil
			default:
				return replay, r.res
			}
		}
	}
	s.records[key] = &idemRecord{fp: fp, pending: true, since: now, created: now}
	return owner, nil
}

func (s *IdempotencyStore) complete(key string, res *stored) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.records[key]; ok {
		r.pending, r.res = false, res
	}
}

// release forgets the key after a failure the client didn't cause, so a retry runs again.
func (s *IdempotencyStore) release(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.records, key)
}

func (s *IdempotencyStore) GC(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, r := range s.records {
		if now.Sub(r.created) > idempotencyTTL {
			delete(s.records, k)
		}
	}
}
