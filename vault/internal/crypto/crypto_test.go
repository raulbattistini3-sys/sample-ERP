package crypto

import (
	"bytes"
	"errors"
	"testing"
)

func key(t *testing.T) []byte {
	t.Helper()
	k, err := RandomKey()
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func TestEnvelopeRoundTripAndRewrap(t *testing.T) {
	kek1, kek2 := key(t), key(t)
	plain := []byte(`{"cpf":"12345678909"}`)
	s, err := SealRecord(kek1, 1, "usuario", "u-1", plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(s.Ciphertext, []byte("12345678909")) {
		t.Fatal("plaintext visible in ciphertext")
	}
	got, err := OpenRecord(kek1, "usuario", "u-1", s)
	if err != nil || !bytes.Equal(got, plain) {
		t.Fatalf("open: %v %q", err, got)
	}
	r, err := Rewrap(kek1, kek2, 2, "usuario", "u-1", s)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(r.Ciphertext, s.Ciphertext) || r.KEKVersion != 2 {
		t.Fatal("rewrap must keep the ciphertext and bump the version")
	}
	if got, err = OpenRecord(kek2, "usuario", "u-1", r); err != nil || !bytes.Equal(got, plain) {
		t.Fatalf("open after rewrap: %v", err)
	}
	if _, err := OpenRecord(kek1, "usuario", "u-1", r); !errors.Is(err, ErrDecrypt) {
		t.Fatal("old KEK must no longer open the rewrapped record")
	}
}

func TestAADBindsOwner(t *testing.T) {
	kek := key(t)
	s, err := SealRecord(kek, 1, "usuario", "u-1", []byte("x"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := OpenRecord(kek, "usuario", "u-2", s); !errors.Is(err, ErrDecrypt) {
		t.Fatal("a record copied to another owner must not decrypt")
	}
}

func TestBlindIndex(t *testing.T) {
	k := key(t)
	a := BlindIndex(k, "usuario", "cpf", Digits("123.456.789-09"))
	b := BlindIndex(k, "usuario", "cpf", Digits("12345678909"))
	if !bytes.Equal(a, b) {
		t.Fatal("normalized values must index the same")
	}
	if bytes.Equal(a, BlindIndex(key(t), "usuario", "cpf", "12345678909")) {
		t.Fatal("another key must give another digest")
	}
}
