package config

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	GRPC     GRPCConfig
	DB       DBConfig
	Importer ImporterConfig
}

type GRPCConfig struct {
	Host string
	Port int
}

// Addr is the host:port the gRPC server listens on.
func (c GRPCConfig) Addr() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
}

type DBConfig struct {
	// same connection string the API uses, e.g. postgresql://postgres:postgres@localhost:5432/sample_erp
	URL string
}

type ImporterConfig struct {
	// same cap as the API's MAX_IMPORT_ROWS (api/src/utils/schemas/produto.schema.ts)
	MaxRows int
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

	cfg := &Config{
		GRPC: GRPCConfig{
			Host: getString("GRPC_HOST", "0.0.0.0"),
			Port: getInt("GRPC_PORT", 50051, &errs),
		},
		DB: DBConfig{
			URL: getRequired("DATABASE_URL", &errs),
		},
		Importer: ImporterConfig{
			MaxRows:      getInt("MAX_IMPORT_ROWS", 5000, &errs),
			Workers:      getInt("IMPORT_WORKERS", 2, &errs),
			Lease:        getDuration("IMPORT_LEASE", 5*time.Minute, &errs),
			MaxAttempts:  getInt("IMPORT_MAX_ATTEMPTS", 3, &errs),
			PollInterval: getDuration("IMPORT_POLL_INTERVAL", 30*time.Second, &errs),
		},
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
