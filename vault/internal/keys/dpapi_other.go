//go:build !windows

package keys

import "errors"

var errNoDPAPI = errors.New("DPAPI is only available on Windows; use VAULT_KEY_PROTECTION=file")

func protect([]byte) ([]byte, error)   { return nil, errNoDPAPI }
func unprotect([]byte) ([]byte, error) { return nil, errNoDPAPI }
