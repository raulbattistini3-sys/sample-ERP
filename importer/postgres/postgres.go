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

// VerificarSchema fails when the database lacks what this service queries: the importacoes table and
// its newest columns (api/drizzle 0011-0013). Checked at startup, so a database the API's migrations
// haven't reached stops the importer with what to do, instead of every claim and sweep failing.
func VerificarSchema(ctx context.Context, pool *pgxpool.Pool) error {
	var colunas int
	err := pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'importacoes'
			AND column_name IN ('planilha', 'linhas_criadas', 'linhas_atualizadas')`).Scan(&colunas)
	if err != nil {
		return fmt.Errorf("postgres: checking the schema: %w", err)
	}
	if colunas < 3 {
		return fmt.Errorf("postgres: the database is missing the importacoes table or its latest columns; " +
			"apply the API's migrations first (cd api && bun run db:migrate, with DATABASE_URL pointing at this database)")
	}
	return nil
}
