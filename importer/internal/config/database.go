package config

import (
	"crypto/x509"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Env is IMPORTER_ENV, which decides how the importer connects to Postgres (like the API's API_ENV):
//
//	production   TLS, with the server's certificate verified against the CA (DATABASE_CA_CERT, or
//	             prod-ca-2021.crt found from the working directory upwards). sslmode=disable and the other
//	             unverified modes in DATABASE_URL are refused: such a connection can be intercepted (MITM).
//	development  plain TCP (a local Postgres has no TLS), unless a CA is configured with DATABASE_CA_CERT.
type Env string

const (
	Production  Env = "production"
	Development Env = "development"
)

// the CA file the repository ships (Supabase's root CA), looked up when DATABASE_CA_CERT is unset
const defaultCAFile = "prod-ca-2021.crt"

// how many parent folders the default CA is searched in: importer/, the repo root, and one more
const caSearchDepth = 3

var insecureSSLModes = map[string]bool{"disable": true, "allow": true, "prefer": true, "require": true}

func getEnv(errs *[]error) Env {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("IMPORTER_ENV")))
	switch Env(v) {
	case Production, Development:
		return Env(v)
	case "":
		*errs = append(*errs, fmt.Errorf("config: IMPORTER_ENV is required: production or development"))
	default:
		*errs = append(*errs, fmt.Errorf("config: IMPORTER_ENV=%q is not valid: use production or development", v))
	}
	return ""
}

// databaseURL rewrites DATABASE_URL's TLS parameters for env: sslmode=verify-full with the CA as
// sslrootcert (which pgx enforces, with no plain-text fallback), or sslmode=disable.
func databaseURL(raw string, env Env, errs *[]error) string {
	if raw == "" || env == "" {
		return raw // already reported
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		*errs = append(*errs, fmt.Errorf("config: DATABASE_URL must be a postgres:// or postgresql:// URL"))
		return raw
	}
	q := u.Query()
	mode := strings.ToLower(q.Get("sslmode"))
	if env == Production && insecureSSLModes[mode] {
		*errs = append(*errs, fmt.Errorf("config: DATABASE_URL has sslmode=%s, but IMPORTER_ENV=production requires verified TLS; remove it", mode))
		return raw
	}
	for k := range q {
		if strings.HasPrefix(k, "ssl") {
			q.Del(k)
		}
	}

	ca, explicit := os.Getenv("DATABASE_CA_CERT"), true
	if ca == "" {
		explicit = false
		if env == Production {
			ca = findUpwards(defaultCAFile, caSearchDepth)
			if ca == "" {
				*errs = append(*errs, fmt.Errorf("config: IMPORTER_ENV=production needs the database CA: put %s in the repo root or set DATABASE_CA_CERT", defaultCAFile))
				return raw
			}
		}
	}
	if ca == "" {
		q.Set("sslmode", "disable")
	} else {
		if err := checkCA(ca); err != nil {
			if explicit {
				err = fmt.Errorf("%w (DATABASE_CA_CERT)", err)
			}
			*errs = append(*errs, err)
			return raw
		}
		q.Set("sslmode", "verify-full")
		q.Set("sslrootcert", ca)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// findUpwards returns the absolute path of name in the working directory or one of its parents.
func findUpwards(name string, depth int) string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for range depth + 1 {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func checkCA(path string) error {
	pem, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("config: database CA certificate %s does not exist", path)
	}
	if err != nil {
		return fmt.Errorf("config: reading the database CA certificate %s: %w", path, err)
	}
	if !x509.NewCertPool().AppendCertsFromPEM(pem) {
		return fmt.Errorf("config: %s is not a PEM certificate", path)
	}
	return nil
}
