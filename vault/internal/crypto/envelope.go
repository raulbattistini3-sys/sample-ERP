package crypto

import "fmt"

// Sealed is one record at rest. The data key (DEK) encrypts the record; the key-encryption key (KEK) of
// version KEKVersion encrypts the DEK. Rotating the KEK rewraps DEKs only, never the records.
type Sealed struct {
	Ciphertext []byte
	Nonce      []byte
	WrappedDEK []byte
	DEKNonce   []byte
	KEKVersion int
}

// AAD binds a record to its owner, so a ciphertext copied onto another row fails to decrypt:
// vault:v1:<owner type>:<owner id>:pii for the data, :dek for the wrapped key.
func AAD(ownerType, ownerID, part string) []byte {
	return fmt.Appendf(nil, "vault:v1:%s:%s:%s", ownerType, ownerID, part)
}

// SealRecord encrypts plaintext under a new random DEK and wraps that DEK with kek.
func SealRecord(kek []byte, kekVersion int, ownerType, ownerID string, plaintext []byte) (Sealed, error) {
	dek, err := RandomKey()
	if err != nil {
		return Sealed{}, err
	}
	defer Zero(dek)
	nonce, ct, err := Seal(dek, plaintext, AAD(ownerType, ownerID, "pii"))
	if err != nil {
		return Sealed{}, err
	}
	dekNonce, wrapped, err := Seal(kek, dek, AAD(ownerType, ownerID, "dek"))
	if err != nil {
		return Sealed{}, err
	}
	return Sealed{Ciphertext: ct, Nonce: nonce, WrappedDEK: wrapped, DEKNonce: dekNonce, KEKVersion: kekVersion}, nil
}

// OpenRecord unwraps the DEK with kek (the record's KEKVersion) and decrypts the record.
func OpenRecord(kek []byte, ownerType, ownerID string, s Sealed) ([]byte, error) {
	dek, err := Open(kek, s.DEKNonce, s.WrappedDEK, AAD(ownerType, ownerID, "dek"))
	if err != nil {
		return nil, err
	}
	defer Zero(dek)
	return Open(dek, s.Nonce, s.Ciphertext, AAD(ownerType, ownerID, "pii"))
}

// Rewrap moves a record's DEK from oldKEK to newKEK; the record's ciphertext is untouched.
func Rewrap(oldKEK, newKEK []byte, newVersion int, ownerType, ownerID string, s Sealed) (Sealed, error) {
	aad := AAD(ownerType, ownerID, "dek")
	dek, err := Open(oldKEK, s.DEKNonce, s.WrappedDEK, aad)
	if err != nil {
		return Sealed{}, err
	}
	defer Zero(dek)
	dekNonce, wrapped, err := Seal(newKEK, dek, aad)
	if err != nil {
		return Sealed{}, err
	}
	s.WrappedDEK, s.DEKNonce, s.KEKVersion = wrapped, dekNonce, newVersion
	return s, nil
}
