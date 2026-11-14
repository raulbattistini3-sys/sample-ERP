// Command vault holds the ERP's sensitive fields (CPF, birth date, ...) encrypted in its own database.
//
//	vault                 serve
//	vault healthcheck     exit 0 when the local server answers /healthz (docker HEALTHCHECK)
//	vault keys new        add a KEK version to VAULT_KEY_DIR; then POST /v1/keys/rotate to rewrap
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/audit"
	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/config"
	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/httpapi"
	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/keys"
	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/service"
	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/storage"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	var err error
	switch {
	case len(os.Args) > 1 && os.Args[1] == "healthcheck":
		err = healthcheck()
	case len(os.Args) > 2 && os.Args[1] == "keys" && os.Args[2] == "new":
		err = newKey()
	case len(os.Args) > 1:
		err = fmt.Errorf("unknown command %q (serve | healthcheck | keys new)", os.Args[1])
	default:
		err = serve()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "vault:", err)
		os.Exit(1)
	}
}

func newKey() error {
	dir := os.Getenv("VAULT_KEY_DIR")
	if dir == "" {
		return errors.New("VAULT_KEY_DIR is required")
	}
	p := keys.Protection(os.Getenv("VAULT_KEY_PROTECTION"))
	if p == "" {
		p = keys.DefaultProtection()
	}
	v, err := keys.NewKEK(dir, p)
	if err != nil {
		return err
	}
	fmt.Printf("created KEK version %d; call POST /v1/keys/rotate with the admin token to rewrap\n", v)
	return nil
}

func healthcheck() error {
	port := os.Getenv("VAULT_PORT")
	if port == "" {
		port = "8200"
	}
	scheme := "http"
	client := &http.Client{Timeout: 3 * time.Second}
	if os.Getenv("VAULT_TLS_CERT") != "" {
		// Only liveness: /healthz needs no client certificate check beyond the handshake, so present ours.
		cert, err := tls.LoadX509KeyPair(os.Getenv("VAULT_TLS_CERT"), os.Getenv("VAULT_TLS_KEY"))
		if err != nil {
			return err
		}
		scheme = "https"
		client.Transport = &http.Transport{TLSClientConfig: &tls.Config{
			Certificates:       []tls.Certificate{cert},
			InsecureSkipVerify: true, // loopback probe of our own server
		}}
	}
	res, err := client.Get(scheme + "://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("healthz: %s", res.Status)
	}
	return nil
}

func serve() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ring, err := keys.Load(cfg.KeyDir, cfg.KeyCreate, cfg.Protection)
	if err != nil {
		return err
	}
	store, err := storage.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.Migrate(ctx); err != nil {
		return err
	}
	api := &httpapi.Server{
		Vault:     &service.Vault{Store: store, Keys: ring, Audit: audit.Log{Store: store}},
		TokenHash: cfg.TokenHash,
		AdminHash: cfg.AdminHash,
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
	}
	if cfg.TLSEnabled() {
		if srv.TLSConfig, err = cfg.ServerTLS(); err != nil {
			return err
		}
	}
	errc := make(chan error, 1)
	go func() {
		_, version := ring.Current()
		slog.Info("vault listening", "addr", cfg.Addr, "mtls", cfg.TLSEnabled(), "kek_version", version)
		if cfg.TLSEnabled() {
			errc <- srv.ListenAndServeTLS("", "")
		} else {
			errc <- srv.ListenAndServe()
		}
	}()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shut, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shut)
}
