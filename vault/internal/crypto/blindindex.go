package crypto

import (
	"crypto/hmac"
	"crypto/sha256"
	"strings"
	"unicode"
)

// BlindIndex is HMAC-SHA-256(indexKey, "<owner type>:<field>:<normalized value>"): equal values give
// equal digests, so a CPF can be found (and kept unique) without storing it or a plain hash of it, which
// for an 11-digit number would be brute-forced in seconds. The index key is not the KEK.
func BlindIndex(indexKey []byte, ownerType, field, normalized string) []byte {
	m := hmac.New(sha256.New, indexKey)
	m.Write([]byte(ownerType + ":" + field + ":" + normalized))
	return m.Sum(nil)
}

// Digits keeps only 0-9: "123.456.789-09" and "12345678909" index the same.
func Digits(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) && r < 128 {
			return r
		}
		return -1
	}, s)
}
