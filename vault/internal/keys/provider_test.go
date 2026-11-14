package keys

import (
	"bytes"
	"runtime"
	"testing"
)

func TestLoadCreatesAndNewKEKBecomesCurrent(t *testing.T) {
	protections := []Protection{File}
	if runtime.GOOS == "windows" {
		protections = append(protections, DPAPI)
	}
	for _, p := range protections {
		t.Run(string(p), func(t *testing.T) {
			dir := t.TempDir()
			r, err := Load(dir, true, p)
			if err != nil {
				t.Fatal(err)
			}
			k1, v := r.Current()
			if v != 1 || len(r.Index()) != 32 {
				t.Fatalf("want kek v1 and an index key, got v%d", v)
			}
			// a second load reads the same keys back
			r2, err := Load(dir, false, p)
			if err != nil {
				t.Fatal(err)
			}
			if k, _ := r2.Current(); !bytes.Equal(k, k1) {
				t.Fatal("reloaded KEK differs")
			}
			if n, err := NewKEK(dir, p); err != nil || n != 2 {
				t.Fatalf("NewKEK: %d %v", n, err)
			}
			if err := r.Reload(); err != nil {
				t.Fatal(err)
			}
			if _, v := r.Current(); v != 2 {
				t.Fatalf("current should be v2, got v%d", v)
			}
			if k, err := r.KEK(1); err != nil || !bytes.Equal(k, k1) {
				t.Fatal("v1 must stay readable")
			}
		})
	}
}

func TestLoadWithoutCreateFailsOnEmptyDir(t *testing.T) {
	if _, err := Load(t.TempDir(), false, File); err == nil {
		t.Fatal("an empty key folder must be an error")
	}
}
