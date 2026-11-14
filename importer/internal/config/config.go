// Package config reads the importer's settings from the environment and a local .env file.
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

// Config is everything the importer needs to start.
type Config struct {
	Env      Env
	GRPC     GRPCConfig
	DB       DBConfig
	Importer ImporterConfig
	HubSpot  HubSpotConfig
}

// HubSpotConfig is what client imports need to write to HubSpot: the same variables as the API's .env.
type HubSpotConfig struct {
	ServiceKey   string // HUBSPOT_SERVICE_KEY; empty: the OAuth connection stored in integracoes
	ClientID     string // HUBSPOT_CLIENT_ID, to refresh that connection's token
	ClientSecret string // HUBSPOT_CLIENT_SECRET
	// INTEGRATIONS_ENCRYPTION_KEY decoded (32 bytes), to read and rewrite the stored tokens
	ChaveCifra []byte
}

// GRPCConfig is the address the gRPC server binds to and its mutual TLS.
type GRPCConfig struct {
	Host string
	Port int
	TLS  TLSConfig
}

// Addr is the host:port the gRPC server listens on.
func (c GRPCConfig) Addr() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
}

// DBConfig is the database connection.
type DBConfig struct {
	// DATABASE_URL with its TLS parameters set for Env (see database.go): verified TLS in production
	URL string
}

// ImporterConfig tunes how imports run.
type ImporterConfig struct {
	// same cap as the API's MAX_IMPORT_ROWS (api/src/utils/schemas/produto.schema.ts)
	MaxRows int
	// MAX_CLIENTES_IMPORT_ROWS: clients go in batches with a checkpoint, so this can be far higher
	MaxClientesRows int
	// batches of a clients/companies import sent to HubSpot at the same time (they share one rate limiter)
	HubspotWorkers int
	// MAX_IMPORT_FILE_MB: the largest spreadsheet the gRPC server accepts (it is the message size limit)
	MaxFileMB int
	// imports processed at the same time by this instance
	Workers int
	// how long a claimed import may stay processando before DevolverTravadas hands it back; also the
	// timeout of one import, so a worker never outlives its claim
	Lease time.Duration
	// claims before a crashing import is failed instead of requeued
	MaxAttempts int
	// how often idle workers check the queue and stuck imports are swept, in case a NOTIFY was missed
	PollInterval time.Duration
}

// Load reads .env (if any) and the environment. It fails on missing required variables or
// values that don't parse, so a misconfigured service stops at startup instead of mid-request.
func Load() (*Config, error) {
	if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("config: reading .env: %w", err)
	}

	var errs []error

	env := getEnv(&errs)
	cfg := &Config{
		Env: env,
		GRPC: GRPCConfig{
			Host: getString("GRPC_HOST", "0.0.0.0"),
			Port: getInt("GRPC_PORT", 50051, &errs),
			TLS:  loadTLSConfig(env, &errs),
		},
		DB: DBConfig{
			URL: databaseURL(getRequired("DATABASE_URL", &errs), env, &errs),
		},
		Importer: ImporterConfig{
			MaxRows:         getInt("MAX_IMPORT_ROWS", 5000, &errs),
			MaxClientesRows: getInt("MAX_CLIENTES_IMPORT_ROWS", 500000, &errs),
			HubspotWorkers:  getInt("IMPORT_HUBSPOT_WORKERS", 4, &errs),
			MaxFileMB:       getInt("MAX_IMPORT_FILE_MB", 128, &errs),
			Workers:         getInt("IMPORT_WORKERS", 2, &errs),
			Lease:           getDuration("IMPORT_LEASE", 5*time.Minute, &errs),
			MaxAttempts:     getInt("IMPORT_MAX_ATTEMPTS", 3, &errs),
			PollInterval:    getDuration("IMPORT_POLL_INTERVAL", 30*time.Second, &errs),
		},
	}
	cfg.HubSpot = HubSpotConfig{
		ServiceKey:   os.Getenv("HUBSPOT_SERVICE_KEY"),
		ClientID:     os.Getenv("HUBSPOT_CLIENT_ID"),
		ClientSecret: os.Getenv("HUBSPOT_CLIENT_SECRET"),
	}
	if raw := os.Getenv("INTEGRATIONS_ENCRYPTION_KEY"); raw != "" {
		chave, err := base64.StdEncoding.DecodeString(raw)
		if err != nil || len(chave) != 32 {
			errs = append(errs, fmt.Errorf("config: INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes in base64"))
		} else {
			cfg.HubSpot.ChaveCifra = chave
		}
	}
	if cfg.Importer.Workers < 1 {
		errs = append(errs, fmt.Errorf("config: IMPORT_WORKERS must be at least 1"))
	}

	if err := errors.Join(errs...); err != nil {
		return nil, err
	}
	return cfg, nil
}

func getString(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getRequired(key string, errs *[]error) string {
	v := os.Getenv(key)
	if v == "" {
		*errs = append(*errs, fmt.Errorf("config: %s is required", key))
	}
	return v
}

func getInt(key string, fallback int, errs *[]error) int {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		*errs = append(*errs, fmt.Errorf("config: %s must be an integer, got %q", key, v))
		return fallback
	}
	return n
}

// getDuration takes Go durations: 30s, 5m, 1h30m.
func getDuration(key string, fallback time.Duration, errs *[]error) time.Duration {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		*errs = append(*errs, fmt.Errorf("config: %s must be a positive duration like 30s or 5m, got %q", key, v))
		return fallback
	}
	return d
}
