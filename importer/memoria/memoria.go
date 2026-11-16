// Package memoria makes the importer's memory elastic, the way a JS heap grows and shrinks: idle, the Go
// runtime is held to a small soft limit (the GC runs early and gives pages back); while an import runs, the
// limit grows by a lease sized from the file; when the last import ends it drops back and the freed pages
// are returned to the operating system at once (debug.FreeOSMemory) instead of minutes later.
//
// The ceiling is the hard limit polyvisor put on the importer's job object (POLYVISOR_MEMORY_HARD_BYTES),
// less a margin for what the runtime does not count (stacks, cgo, the binary). Without polyvisor it is
// IMPORT_MEMORY_MAX_MB, or no ceiling. A Go soft limit is not a cap: past it the GC works harder, it does
// not fail allocations, so a lease that is too small costs CPU, never an import.
package memoria

import (
	"math"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
)

const mb = 1 << 20

// Config: base is the idle limit, teto the ceiling (0: none), fator how many bytes of heap one byte of
// spreadsheet may need (a .xlsx is zipped: its rows take several times the file).
type Config struct {
	Base  uint64
	Teto  uint64
	Fator float64
}

// DoAmbiente reads IMPORT_MEMORY_BASE_MB (default 128), IMPORT_MEMORY_FACTOR (default 6) and the ceiling:
// 90% of POLYVISOR_MEMORY_HARD_BYTES, else IMPORT_MEMORY_MAX_MB.
func DoAmbiente() Config {
	c := Config{Base: 128 * mb, Fator: 6}
	if v := envUint("IMPORT_MEMORY_BASE_MB"); v > 0 {
		c.Base = v * mb
	}
	if v, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv("IMPORT_MEMORY_FACTOR")), 64); err == nil && v > 0 {
		c.Fator = v
	}
	if hard := envUint("POLYVISOR_MEMORY_HARD_BYTES"); hard > 0 {
		c.Teto = hard / 10 * 9
	} else if v := envUint("IMPORT_MEMORY_MAX_MB"); v > 0 {
		c.Teto = v * mb
	}
	if c.Teto > 0 && c.Base > c.Teto {
		c.Base = c.Teto
	}
	return c
}

func envUint(k string) uint64 {
	v, _ := strconv.ParseUint(strings.TrimSpace(os.Getenv(k)), 10, 64)
	return v
}

// Elastico holds the leases of the imports running now and keeps the runtime's soft limit at base plus
// their sum, capped at the ceiling.
type Elastico struct {
	cfg      Config
	mu       sync.Mutex
	reservas uint64
	ativas   int
	aplicar  func(limite int64) // debug.SetMemoryLimit, swappable in tests
	liberar  func()             // debug.FreeOSMemory
}

func Novo(cfg Config) *Elastico {
	e := &Elastico{cfg: cfg, aplicar: func(l int64) { debug.SetMemoryLimit(l) }, liberar: debug.FreeOSMemory}
	e.mu.Lock()
	e.ajustar()
	e.mu.Unlock()
	return e
}

// Limite is the soft limit in force now.
func (e *Elastico) Limite() uint64 {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.limite()
}

func (e *Elastico) limite() uint64 {
	l := e.cfg.Base + e.reservas
	if e.cfg.Teto > 0 && l > e.cfg.Teto {
		l = e.cfg.Teto
	}
	return l
}

func (e *Elastico) ajustar() {
	l := e.limite()
	if l > math.MaxInt64 {
		l = math.MaxInt64
	}
	e.aplicar(int64(l))
}

// Reservar grows the limit for one import of a file of `bytes` and returns the call that gives it back.
// The call is safe to make more than once.
func (e *Elastico) Reservar(bytes int64) (devolver func()) {
	r := uint64(float64(max(bytes, 0)) * e.cfg.Fator)
	if r < 32*mb {
		r = 32 * mb // a small file still needs its batches, the HubSpot replies and the parser
	}
	e.mu.Lock()
	e.reservas += r
	e.ativas++
	e.ajustar()
	e.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			e.mu.Lock()
			e.reservas -= r
			e.ativas--
			e.ajustar()
			ocioso := e.ativas == 0
			e.mu.Unlock()
			if ocioso {
				// back to idle: hand the pages to the OS now, like a JS heap shrinking after the work
				e.liberar()
			}
		})
	}
}
