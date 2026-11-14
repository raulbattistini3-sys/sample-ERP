package config

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
)

// TLSConfig is the gRPC server's mutual TLS: its own certificate and the CA that signs the clients it
// accepts (the API). The files come from secrets/generate.ts (docker compose) or from the launcher
// (data/certs). All three empty means a plaintext server; that is refused when IMPORTER_ENV=production.
//
//	GRPC_TLS_CERT       PEM certificate the importer presents (SANs: importer, localhost, 127.0.0.1)
//	GRPC_TLS_KEY        its private key
//	GRPC_TLS_CLIENT_CA  PEM CA a client certificate must chain to; anything else is refused at the handshake
type TLSConfig struct {
	CertFile     string
	KeyFile      string
	ClientCAFile string
}

// Enabled reports whether the server runs mutual TLS.
func (c TLSConfig) Enabled() bool {
	return c.CertFile != "" || c.KeyFile != "" || c.ClientCAFile != ""
}

func loadTLSConfig(env Env, errs *[]error) TLSConfig {
	c := TLSConfig{
		CertFile:     os.Getenv("GRPC_TLS_CERT"),
		KeyFile:      os.Getenv("GRPC_TLS_KEY"),
		ClientCAFile: os.Getenv("GRPC_TLS_CLIENT_CA"),
	}
	switch {
	case !c.Enabled():
		if env == Production {
			*errs = append(*errs, errors.New("config: GRPC_TLS_CERT, GRPC_TLS_KEY and GRPC_TLS_CLIENT_CA are required in production (mutual TLS with the API)"))
		}
	case c.CertFile == "" || c.KeyFile == "" || c.ClientCAFile == "":
		*errs = append(*errs, errors.New("config: set all of GRPC_TLS_CERT, GRPC_TLS_KEY and GRPC_TLS_CLIENT_CA, or none of them"))
	default:
		if _, err := c.Server(); err != nil {
			*errs = append(*errs, err)
		}
	}
	return c
}

// Server is the tls.Config of the gRPC server: TLS 1.3, and a client certificate signed by ClientCAFile
// is required on every connection.
func (c TLSConfig) Server() (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(c.CertFile, c.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("config: GRPC_TLS_CERT/GRPC_TLS_KEY: %w", err)
	}
	pool, err := LoadCertPool(c.ClientCAFile)
	if err != nil {
		return nil, fmt.Errorf("config: GRPC_TLS_CLIENT_CA: %w", err)
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
	}, nil
}

// LoadCertPool reads a PEM file of one or more CA certificates.
func LoadCertPool(path string) (*x509.CertPool, error) {
	pem, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("%s holds no PEM certificate", path)
	}
	return pool, nil
}
