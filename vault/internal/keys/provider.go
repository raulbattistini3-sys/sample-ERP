// Package keys loads the vault's keys from VAULT_KEY_DIR, never from the database, the image or the
// environment:
//
//	kek-<n>.key    key-encryption key version n, 64 hex characters (docker: written by secrets/generate.ts
//	               and mounted as a secret)
//	kek-<n>.dpapi  the same key protected with Windows DPAPI (the launcher's .exe): only the Windows account
//	               that created it can unprotect it, so a copied data folder is useless elsewhere
//	index.key / index.dpapi  the blind-index HMAC key, separate from the KEKs
//
// The highest n is the current KEK: new records use it, older versions stay to read (and rewrap) records
// sealed under them.
package keys

import (
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/crypto"
)

// Protection is how new key files are written.
type Protection string

const (
	File  Protection = "file"  // hex, guarded by file permissions (and docker secrets)
	DPAPI Protection = "dpapi" // Windows only
)

// DefaultProtection is DPAPI on Windows, a plain file elsewhere.
func DefaultProtection() Protection {
	if runtime.GOOS == "windows" {
		return DPAPI
	}
	return File
}

var kekName = regexp.MustCompile(`^kek-([1-9][0-9]*)\.(key|dpapi)$`)

// Ring holds the loaded keys. Reload re-reads the folder (after `vault keys new`).
type Ring struct {
	dir string
	mu  sync.RWMutex
	kek map[int][]byte
	cur int
	idx []byte
}

// Load reads dir. With create, a missing folder, KEK or index key is generated with protection p
// (first launch); without it a missing key is an error.
func Load(dir string, create bool, p Protection) (*Ring, error) {
	if create {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("keys: creating %s: %w", dir, err)
		}
	}
	r := &Ring{dir: dir}
	if err := r.Reload(); err != nil {
		if !create {
			return nil, err
		}
	}
	if !create {
		return r, nil
	}
	if r.idx == nil {
		if err := writeNew(dir, "index", p); err != nil {
			return nil, err
		}
	}
	if r.cur == 0 {
		if err := writeNew(dir, "kek-1", p); err != nil {
			return nil, err
		}
	}
	return r, r.Reload()
}

// Reload re-reads every key file in the folder.
func (r *Ring) Reload() error {
	entries, err := os.ReadDir(r.dir)
	if err != nil {
		return fmt.Errorf("keys: reading VAULT_KEY_DIR %s: %w", r.dir, err)
	}
	kek := map[int][]byte{}
	var idx []byte
	for _, e := range entries {
		name := e.Name()
		switch {
		case name == "index.key" || name == "index.dpapi":
			if idx, err = readKey(filepath.Join(r.dir, name)); err != nil {
				return err
			}
		case kekName.MatchString(name):
			n, _ := strconv.Atoi(kekName.FindStringSubmatch(name)[1])
			k, err := readKey(filepath.Join(r.dir, name))
			if err != nil {
				return err
			}
			kek[n] = k
		}
	}
	if idx == nil {
		return fmt.Errorf("keys: %s has no index.key or index.dpapi", r.dir)
	}
	if len(kek) == 0 {
		return fmt.Errorf("keys: %s has no kek-<n>.key or kek-<n>.dpapi", r.dir)
	}
	cur := 0
	for n := range kek {
		cur = max(cur, n)
	}
	r.mu.Lock()
	r.kek, r.cur, r.idx = kek, cur, idx
	r.mu.Unlock()
	return nil
}

// Current returns the KEK new records are sealed with, and its version.
func (r *Ring) Current() ([]byte, int) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.kek[r.cur], r.cur
}

// KEK returns version n.
func (r *Ring) KEK(n int) ([]byte, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	k, ok := r.kek[n]
	if !ok {
		return nil, fmt.Errorf("keys: KEK version %d is not in VAULT_KEY_DIR", n)
	}
	return k, nil
}

// Versions lists the loaded KEK versions, ascending.
func (r *Ring) Versions() []int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]int, 0, len(r.kek))
	for n := range r.kek {
		out = append(out, n)
	}
	sort.Ints(out)
	return out
}

// Index returns the blind-index key.
func (r *Ring) Index() []byte {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.idx
}

// NewKEK writes kek-<current+1> to dir; the server picks it up on reload (POST /v1/keys/rotate).
func NewKEK(dir string, p Protection) (int, error) {
	r := &Ring{dir: dir}
	next := 1
	if err := r.Reload(); err == nil {
		next = r.cur + 1
	} else if _, statErr := os.Stat(dir); statErr != nil {
		return 0, err
	}
	return next, writeNew(dir, "kek-"+strconv.Itoa(next), p)
}

func readKey(path string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("keys: reading %s: %w", path, err)
	}
	var k []byte
	if strings.HasSuffix(path, ".dpapi") {
		if k, err = unprotect(raw); err != nil {
			return nil, fmt.Errorf("keys: unprotecting %s (DPAPI keys only open for the Windows account that made them): %w", path, err)
		}
	} else if k, err = hex.DecodeString(strings.TrimSpace(string(raw))); err != nil {
		return nil, fmt.Errorf("keys: %s must hold 64 hex characters", path)
	}
	if len(k) != crypto.KeySize {
		return nil, fmt.Errorf("keys: %s must hold a %d-byte key, got %d", path, crypto.KeySize, len(k))
	}
	return k, nil
}

func writeNew(dir, base string, p Protection) error {
	k, err := crypto.RandomKey()
	if err != nil {
		return err
	}
	defer crypto.Zero(k)
	var path string
	var body []byte
	switch p {
	case DPAPI:
		path = filepath.Join(dir, base+".dpapi")
		if body, err = protect(k); err != nil {
			return fmt.Errorf("keys: DPAPI protecting %s: %w", path, err)
		}
	case File:
		path = filepath.Join(dir, base+".key")
		body = []byte(hex.EncodeToString(k) + "\n")
	default:
		return fmt.Errorf("keys: unknown protection %q (use file or dpapi)", p)
	}
	// O_EXCL: never overwrite a key, which would make every record sealed under it unreadable
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, fs.ErrExist) {
		return fmt.Errorf("keys: %s already exists", path)
	}
	if err != nil {
		return fmt.Errorf("keys: writing %s: %w", path, err)
	}
	if _, err := f.Write(body); err != nil {
		f.Close()
		return fmt.Errorf("keys: writing %s: %w", path, err)
	}
	return f.Close()
}
