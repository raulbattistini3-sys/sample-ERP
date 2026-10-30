// Package postgres owns the connection pool and the queries against the shared sample_erp database.
// The schema itself is managed by drizzle in api/drizzle (0011_importacoes.sql for this service's table).
package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// how long startup waits for the database before giving up
const connectTimeout = 10 * time.Second

// NewPool connects with the same DATABASE_URL the API uses and pings once, so a wrong URL or a
// database that is down fails at startup. Pool sizing can be tuned in the URL itself
// (e.g. ?pool_max_conns=10).
func NewPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("postgres: parsing DATABASE_URL: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: connecting: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("postgres: ping: %w", err)
	}
	return pool, nil
}
