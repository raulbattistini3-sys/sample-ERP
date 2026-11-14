// Package storage is the vault's Postgres: its own database (VAULT_DATABASE_URL), migrated on start.
package storage

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/raulbattistini3-sys/sample-ERP/vault/internal/crypto"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Record is a row of vault_records.
type Record struct {
	ID        string
	OwnerType string
	OwnerID   string
	Sealed    crypto.Sealed
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Index is one blind index to keep with a record.
type Index struct {
	Field  string
	Digest []byte
}

var (
	ErrNotFound  = errors.New("storage: record not found")
	ErrDuplicate = errors.New("storage: another record already holds this value")
)

type Store struct{ pool *pgxpool.Pool }

func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("storage: connecting to VAULT_DATABASE_URL: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

// Migrate applies the embedded migrations not yet in vault_schema_migrations, each in its own transaction.
func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS vault_schema_migrations (
		version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("storage: migrations table: %w", err)
	}
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		base := strings.TrimPrefix(name, "migrations/")
		v, err := strconv.Atoi(strings.SplitN(base, "_", 2)[0])
		if err != nil {
			return fmt.Errorf("storage: migration %s must start with its number", base)
		}
		sql, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
			tag, err := tx.Exec(ctx, `INSERT INTO vault_schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`, v)
			if err != nil || tag.RowsAffected() == 0 {
				return err // already applied
			}
			_, err = tx.Exec(ctx, string(sql))
			return err
		})
		if err != nil {
			return fmt.Errorf("storage: applying %s: %w", base, err)
		}
	}
	return nil
}

func isUnique(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

const cols = `id::text, owner_type, owner_id, ciphertext, nonce, wrapped_dek, dek_nonce, kek_version, created_at, updated_at`

func scan(row pgx.Row) (Record, error) {
	var r Record
	err := row.Scan(&r.ID, &r.OwnerType, &r.OwnerID, &r.Sealed.Ciphertext, &r.Sealed.Nonce,
		&r.Sealed.WrappedDEK, &r.Sealed.DEKNonce, &r.Sealed.KEKVersion, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	return r, err
}

// Put creates or replaces the owner's record and its blind indexes in one transaction. It returns
// ErrDuplicate when an index value already belongs to another record.
func (s *Store) Put(ctx context.Context, ownerType, ownerID string, sealed crypto.Sealed, idx []Index) (Record, error) {
	var out Record
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		out, err = scan(tx.QueryRow(ctx, `
			INSERT INTO vault_records (owner_type, owner_id, ciphertext, nonce, wrapped_dek, dek_nonce, kek_version)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (owner_type, owner_id) DO UPDATE SET
			  ciphertext = excluded.ciphertext, nonce = excluded.nonce, wrapped_dek = excluded.wrapped_dek,
			  dek_nonce = excluded.dek_nonce, kek_version = excluded.kek_version, updated_at = now()
			RETURNING `+cols,
			ownerType, ownerID, sealed.Ciphertext, sealed.Nonce, sealed.WrappedDEK, sealed.DEKNonce, sealed.KEKVersion))
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM vault_blind_indexes WHERE record_id = $1`, out.ID); err != nil {
			return err
		}
		for _, i := range idx {
			if _, err := tx.Exec(ctx, `INSERT INTO vault_blind_indexes (record_id, owner_type, field, digest) VALUES ($1, $2, $3, $4)`,
				out.ID, ownerType, i.Field, i.Digest); err != nil {
				if isUnique(err) {
					return ErrDuplicate
				}
				return err
			}
		}
		return nil
	})
	return out, err
}

func (s *Store) Get(ctx context.Context, ownerType, ownerID string) (Record, error) {
	return scan(s.pool.QueryRow(ctx, `SELECT `+cols+` FROM vault_records WHERE owner_type = $1 AND owner_id = $2`, ownerType, ownerID))
}

// GetMany returns the records found among ownerIDs (missing ones are left out).
func (s *Store) GetMany(ctx context.Context, ownerType string, ownerIDs []string) ([]Record, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+cols+` FROM vault_records WHERE owner_type = $1 AND owner_id = ANY($2)`, ownerType, ownerIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Record
	for rows.Next() {
		r, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Delete removes the record (its indexes cascade). Deleting a missing record is not an error.
func (s *Store) Delete(ctx context.Context, ownerType, ownerID string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM vault_records WHERE owner_type = $1 AND owner_id = $2`, ownerType, ownerID)
	return tag.RowsAffected() > 0, err
}

// Lookup returns the owner id whose blind index for field equals digest.
func (s *Store) Lookup(ctx context.Context, ownerType, field string, digest []byte) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		SELECT r.owner_id FROM vault_blind_indexes i JOIN vault_records r ON r.id = i.record_id
		WHERE i.owner_type = $1 AND i.field = $2 AND i.digest = $3`, ownerType, field, digest).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// Rewrap walks the records not on version target in batches, letting fn replace each one's wrapped key.
// It returns how many records moved.
func (s *Store) Rewrap(ctx context.Context, target int, fn func(Record) (crypto.Sealed, error)) (int, error) {
	moved := 0
	for {
		n := 0
		err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
			rows, err := tx.Query(ctx, `SELECT `+cols+` FROM vault_records WHERE kek_version <> $1 LIMIT 200 FOR UPDATE SKIP LOCKED`, target)
			if err != nil {
				return err
			}
			var batch []Record
			for rows.Next() {
				r, err := scan(rows)
				if err != nil {
					rows.Close()
					return err
				}
				batch = append(batch, r)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
			for _, r := range batch {
				sealed, err := fn(r)
				if err != nil {
					return fmt.Errorf("record %s: %w", r.ID, err)
				}
				if _, err := tx.Exec(ctx, `UPDATE vault_records SET wrapped_dek = $2, dek_nonce = $3, kek_version = $4 WHERE id = $1`,
					r.ID, sealed.WrappedDEK, sealed.DEKNonce, sealed.KEKVersion); err != nil {
					return err
				}
			}
			n = len(batch)
			return nil
		})
		if err != nil {
			return moved, err
		}
		moved += n
		if n == 0 {
			return moved, nil
		}
	}
}

// AuditEntry is one row of vault_audit.
type AuditEntry struct {
	Service, Actor, Action, OwnerType, OwnerID, Outcome, RequestID string
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Store) Audit(ctx context.Context, e AuditEntry) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO vault_audit (service, actor, action, owner_type, owner_id, outcome, request_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, e.Service, nullable(e.Actor), e.Action, nullable(e.OwnerType), nullable(e.OwnerID), e.Outcome, nullable(e.RequestID))
	return err
}

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }
