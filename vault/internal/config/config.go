// Package config reads the vault's environment once at start and refuses to run on a bad one.
//
//	VAULT_ENV                  development | production (production requires mTLS and both token hashes)
//	VAULT_HOST / VAULT_PORT    listen address, default 127.0.0.1:8200
//	VAULT_DATABASE_URL         the vault's own Postgres (never the ERP's)
//	VAULT_KEY_DIR              folder with kek-<n>.key|.dpapi and index.key|.dpapi
//	VAULT_KEY_CREATE           true: create the first KEK and the index key when the folder is empty
//	VAULT_KEY_PROTECTION       file | dpapi (default dpapi on Windows, file elsewhere)
//	VAULT_TOKEN_SHA256         hex SHA-256 of the API's token (VAULT_TOKEN in api/.env)
//	VAULT_ADMIN_TOKEN_SHA256   hex SHA-256 of the admin token that may rotate keys (optional)
//	VAULT_TLS_CERT / _KEY      the certificate the vault presents (SANs: vault, localhost, 127.0.0.1)
//	VAULT_TLS_CLIENT_CA        CA the API's client certificate must chain to
package config

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/keys"
)

type Config struct {
	Production  bool
	Addr        string
	DatabaseURL string
	KeyDir      string
	KeyCreate   bool
	Protection  keys.Protection
	TokenHash   []byte
	AdminHash   []byte
	TLSCert     string
	TLSKey      string
	TLSClientCA string
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func hash(name string, errs *[]error) []byte {
	v := env(name, "")
	if v == "" {
		return nil
	}
	b, err := hex.DecodeString(v)
	if err != nil || len(b) != 32 {
		*errs = append(*errs, fmt.Errorf("config: %s must be 64 hex characters (a SHA-256)", name))
		return nil
	}
	return b
}

func Load() (Config, error) {
	var errs []error
	c := Config{
		Production:  env("VAULT_ENV", "development") == "production",
		Addr:        net.JoinHostPort(env("VAULT_HOST", "127.0.0.1"), env("VAULT_PORT", "8200")),
		DatabaseURL: env("VAULT_DATABASE_URL", ""),
		KeyDir:      env("VAULT_KEY_DIR", ""),
		KeyCreate:   env("VAULT_KEY_CREATE", "false") == "true",
		Protection:  keys.Protection(env("VAULT_KEY_PROTECTION", string(keys.DefaultProtection()))),
		TokenHash:   hash("VAULT_TOKEN_SHA256", &errs),
		AdminHash:   hash("VAULT_ADMIN_TOKEN_SHA256", &errs),
		TLSCert:     env("VAULT_TLS_CERT", ""),
		TLSKey:      env("VAULT_TLS_KEY", ""),
		TLSClientCA: env("VAULT_TLS_CLIENT_CA", ""),
	}
	if c.DatabaseURL == "" && env("VAULT_DB_HOST", "") != "" {
		// docker compose: the password comes from secrets.env, so the URL is put together here
		u := url.URL{
			Scheme:   "postgres",
			User:     url.UserPassword(env("VAULT_DB_USER", "vault"), env("VAULT_DB_PASSWORD", "")),
			Host:     net.JoinHostPort(env("VAULT_DB_HOST", ""), env("VAULT_DB_PORT", "5432")),
			Path:     "/" + env("VAULT_DB_NAME", "sample_erp_vault"),
			RawQuery: "sslmode=" + env("VAULT_DB_SSLMODE", "disable"),
		}
		c.DatabaseURL = u.String()
	}
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("config: VAULT_DATABASE_URL (or VAULT_DB_HOST + VAULT_DB_PASSWORD) is required"))
	}
	if c.KeyDir == "" {
		errs = append(errs, errors.New("config: VAULT_KEY_DIR is required"))
	}
	if c.Protection != keys.File && c.Protection != keys.DPAPI {
		errs = append(errs, errors.New("config: VAULT_KEY_PROTECTION must be file or dpapi"))
	}
	if c.TokenHash == nil {
		errs = append(errs, errors.New("config: VAULT_TOKEN_SHA256 is required"))
	}
	tlsAny := c.TLSCert != "" || c.TLSKey != "" || c.TLSClientCA != ""
	tlsAll := c.TLSCert != "" && c.TLSKey != "" && c.TLSClientCA != ""
	switch {
	case tlsAny && !tlsAll:
		errs = append(errs, errors.New("config: set all of VAULT_TLS_CERT, VAULT_TLS_KEY and VAULT_TLS_CLIENT_CA, or none"))
	case !tlsAny && c.Production:
		errs = append(errs, errors.New("config: mutual TLS (VAULT_TLS_*) is required in production"))
	case tlsAll:
		if _, err := c.ServerTLS(); err != nil {
			errs = append(errs, err)
		}
	}
	return c, errors.Join(errs...)
}

func (c Config) TLSEnabled() bool { return c.TLSCert != "" }

// ServerTLS is TLS 1.3 with a required client certificate signed by VAULT_TLS_CLIENT_CA.
func (c Config) ServerTLS() (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(c.TLSCert, c.TLSKey)
	if err != nil {
		return nil, fmt.Errorf("config: VAULT_TLS_CERT/KEY: %w", err)
	}
	pem, err := os.ReadFile(c.TLSClientCA)
	if err != nil {
		return nil, fmt.Errorf("config: VAULT_TLS_CLIENT_CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, errors.New("config: VAULT_TLS_CLIENT_CA holds no certificate")
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		ClientCAs:    pool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
	}, nil
}
