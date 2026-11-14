// Package crypto is the vault's cryptography: AES-256-GCM, envelope encryption (a data key per record,
// wrapped by a key-encryption key) and blind indexes (HMAC-SHA-256) for exact-match lookups.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
)

// KeySize is the size of every key here: AES-256, and the HMAC-SHA-256 blind-index key.
const KeySize = 32

// RandomKey returns KeySize bytes from the OS CSPRNG.
func RandomKey() ([]byte, error) {
	k := make([]byte, KeySize)
	if _, err := rand.Read(k); err != nil {
		return nil, fmt.Errorf("crypto: reading random bytes: %w", err)
	}
	return k, nil
}

func gcm(key []byte) (cipher.AEAD, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("crypto: key must be %d bytes, got %d", KeySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Seal encrypts plaintext with AES-256-GCM under a fresh random 96-bit nonce. The returned ciphertext
// carries the 16-byte authentication tag at its end; aad is authenticated but not encrypted.
func Seal(key, plaintext, aad []byte) (nonce, ciphertext []byte, err error) {
	aead, err := gcm(key)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, fmt.Errorf("crypto: reading nonce: %w", err)
	}
	return nonce, aead.Seal(nil, nonce, plaintext, aad), nil
}

// ErrDecrypt is returned for any failed authentication: a wrong key, a tampered ciphertext, or a record
// moved to another owner (its AAD no longer matches).
var ErrDecrypt = errors.New("crypto: authentication failed")

// Open reverses Seal.
func Open(key, nonce, ciphertext, aad []byte) ([]byte, error) {
	aead, err := gcm(key)
	if err != nil {
		return nil, err
	}
	if len(nonce) != aead.NonceSize() {
		return nil, ErrDecrypt
	}
	out, err := aead.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return nil, ErrDecrypt
	}
	return out, nil
}

// Zero overwrites a key once it is no longer needed (best effort: Go may have copied it).
func Zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
