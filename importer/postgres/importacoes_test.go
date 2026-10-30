package postgres

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Integration tests: they need a throwaway database with the api/drizzle migrations applied (the docker
// init scripts do that) and they DELETE every row of importacoes, so never point them at a real one.
// -p 1 because importer/importacao's tests share that queue: packages running in parallel would claim
// and sweep each other's jobs.
//
//	IMPORTER_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/importer_test?sslmode=disable go test -p 1 ./importer/...
func setup(t *testing.T) (*Importacoes, *pgxpool.Pool, string) {
	t.Helper()
	url := os.Getenv("IMPORTER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("IMPORTER_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := NewPool(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	// Reivindicar takes any pending row, so every test starts from an empty queue
	if _, err := pool.Exec(ctx, `DELETE FROM importacoes`); err != nil {
		t.Fatal(err)
	}
	var usuarioID string
	err = pool.QueryRow(ctx, `
		INSERT INTO usuarios (nome, permissoes, email, senha, ativo)
		VALUES ('importer test', (enum_range(NULL::permissoes_usuario))[1], $1, 'x', true)
		RETURNING id`, fmt.Sprintf("importer-test-%d@example.com", time.Now().UnixNano())).Scan(&usuarioID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM importacoes WHERE usuario_id = $1`, usuarioID)
		pool.Exec(context.Background(), `DELETE FROM usuarios WHERE id = $1`, usuarioID)
	})
	return NewImportacoes(pool), pool, usuarioID
}

func TestCriarObter(t *testing.T) {
	repo, _, usuarioID := setup(t)
	ctx := context.Background()

	criada, err := repo.Criar(ctx, usuarioID, "produtos.xlsx", []byte("xlsx"))
	if err != nil {
		t.Fatal(err)
	}
	if criada.Status != StatusPendente || criada.Tentativas != 0 || len(criada.Erros) != 0 {
		t.Fatalf("new importacao = %+v", criada)
	}

	lida, err := repo.Obter(ctx, criada.ID)
	if err != nil {
		t.Fatal(err)
	}
	if lida.ID != criada.ID || lida.NomeArquivo != "produtos.xlsx" || lida.UsuarioID != usuarioID {
		t.Fatalf("Obter = %+v, want %+v", lida, criada)
	}

	if _, err := repo.Obter(ctx, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, ErrNaoEncontrada) {
		t.Errorf("Obter(unknown) err = %v, want ErrNaoEncontrada", err)
	}
	if _, err := repo.Obter(ctx, "not-a-uuid"); !errors.Is(err, ErrIDInvalido) {
		t.Errorf("Obter(not-a-uuid) err = %v, want ErrIDInvalido", err)
	}
	if _, err := repo.Criar(ctx, "00000000-0000-0000-0000-000000000000", "a.xlsx", []byte("x")); !errors.Is(err, ErrUsuarioNaoEncontrado) {
		t.Errorf("Criar(unknown usuario) err = %v, want ErrUsuarioNaoEncontrado", err)
	}
}

func TestCriarNotificacao(t *testing.T) {
	repo, pool, usuarioID := setup(t)
	ctx := context.Background()

	// LISTEN needs a connection of its own for as long as it listens
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN "+CanalImportacoes); err != nil {
		t.Fatal(err)
	}

	criada, err := repo.Criar(ctx, usuarioID, "a.xlsx", []byte("x"))
	if err != nil {
		t.Fatal(err)
	}

	waitCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	n, err := conn.Conn().WaitForNotification(waitCtx)
	if err != nil {
		t.Fatal(err)
	}
	if n.Channel != CanalImportacoes || n.Payload != criada.ID {
		t.Fatalf("notification = %s %q, want %s %q", n.Channel, n.Payload, CanalImportacoes, criada.ID)
	}
}

func TestReivindicarConcorrente(t *testing.T) {
	repo, _, usuarioID := setup(t)
	ctx := context.Background()

	const jobs, workers = 50, 8
	planilhas := make(map[string][]byte, jobs)
	for i := range jobs {
		p := []byte(fmt.Sprintf("planilha %d", i))
		imp, err := repo.Criar(ctx, usuarioID, fmt.Sprintf("%d.xlsx", i), p)
		if err != nil {
			t.Fatal(err)
		}
		planilhas[imp.ID] = p
	}

	var (
		mu       sync.Mutex
		claimed  = make(map[string]int) // id -> how many workers got it
		wg       sync.WaitGroup
		firstErr error
	)
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				job, err := repo.Reivindicar(ctx)
				if err != nil || job == nil {
					if err != nil {
						mu.Lock()
						firstErr = errors.Join(firstErr, err)
						mu.Unlock()
					}
					return
				}
				if job.Status != StatusProcessando || job.Tentativas != 1 || !bytes.Equal(job.Planilha, planilhas[job.ID]) {
					mu.Lock()
					firstErr = errors.Join(firstErr, fmt.Errorf("claimed job = %+v", job.Importacao))
					mu.Unlock()
				}
				mu.Lock()
				claimed[job.ID]++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if firstErr != nil {
		t.Fatal(firstErr)
	}
	if len(claimed) != jobs {
		t.Fatalf("claimed %d distinct jobs, want %d", len(claimed), jobs)
	}
	for id, n := range claimed {
		if n != 1 {
			t.Errorf("job %s claimed %d times", id, n)
		}
	}
}

func TestFinalizar(t *testing.T) {
	repo, pool, usuarioID := setup(t)
	ctx := context.Background()

	if _, err := repo.Criar(ctx, usuarioID, "a.xlsx", []byte("x")); err != nil {
		t.Fatal(err)
	}
	job, err := repo.Reivindicar(ctx)
	if err != nil || job == nil {
		t.Fatalf("Reivindicar = %v, %v", job, err)
	}

	// rolled back with the transaction it runs in
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if err := repo.Finalizar(ctx, tx, job, Resultado{Status: StatusConcluida}); err != nil {
			return err
		}
		return errors.New("rollback")
	})
	if err == nil || err.Error() != "rollback" {
		t.Fatalf("transaction err = %v", err)
	}
	if imp, _ := repo.Obter(ctx, job.ID); imp.Status != StatusProcessando {
		t.Fatalf("after rollback status = %s, want processando", imp.Status)
	}

	erros := []ErroLinha{{Linha: 3, Campo: "sku", Mensagem: "SKU repetido"}}
	res := Resultado{Status: StatusRejeitada, TotalLinhas: 10, Erros: erros}
	if err := repo.Finalizar(ctx, pool, job, res); err != nil {
		t.Fatal(err)
	}
	imp, err := repo.Obter(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if imp.Status != StatusRejeitada || imp.TotalLinhas != 10 || len(imp.Erros) != 1 || imp.Erros[0] != erros[0] || imp.FinalizadaEm == nil {
		t.Fatalf("finished importacao = %+v", imp)
	}
	var semPlanilha bool
	if err := pool.QueryRow(ctx, `SELECT planilha IS NULL FROM importacoes WHERE id = $1`, job.ID).Scan(&semPlanilha); err != nil || !semPlanilha {
		t.Fatalf("planilha cleared = %v, %v", semPlanilha, err)
	}

	if err := repo.Finalizar(ctx, pool, job, res); !errors.Is(err, ErrReivindicacaoPerdida) {
		t.Errorf("second Finalizar err = %v, want ErrReivindicacaoPerdida", err)
	}
	if err := repo.Finalizar(ctx, pool, job, Resultado{Status: StatusPendente}); err == nil {
		t.Error("Finalizar with a non-final status succeeded")
	}
}

func TestDevolverTravadas(t *testing.T) {
	repo, _, usuarioID := setup(t)
	ctx := context.Background()

	criada, err := repo.Criar(ctx, usuarioID, "a.xlsx", []byte("x"))
	if err != nil {
		t.Fatal(err)
	}
	lento, _ := repo.Reivindicar(ctx)

	// prazo 0: anything processando counts as stuck
	devolvidas, falhas, err := repo.DevolverTravadas(ctx, 0, 3)
	if err != nil || devolvidas != 1 || falhas != 0 {
		t.Fatalf("DevolverTravadas = %d, %d, %v; want 1, 0", devolvidas, falhas, err)
	}

	novo, _ := repo.Reivindicar(ctx)
	if novo == nil || novo.ID != criada.ID || novo.Tentativas != 2 || !bytes.Equal(novo.Planilha, []byte("x")) {
		t.Fatalf("reclaimed job = %+v", novo)
	}
	// the slow worker comes back after the job was handed to someone else
	if err := repo.Finalizar(ctx, repo.pool, lento, Resultado{Status: StatusConcluida}); !errors.Is(err, ErrReivindicacaoPerdida) {
		t.Fatalf("stale Finalizar err = %v, want ErrReivindicacaoPerdida", err)
	}

	// out of tentativas: failed instead of requeued
	devolvidas, falhas, err = repo.DevolverTravadas(ctx, 0, 2)
	if err != nil || devolvidas != 0 || falhas != 1 {
		t.Fatalf("DevolverTravadas = %d, %d, %v; want 0, 1", devolvidas, falhas, err)
	}
	imp, _ := repo.Obter(ctx, criada.ID)
	if imp.Status != StatusFalhou || imp.Mensagem == "" || imp.FinalizadaEm == nil {
		t.Fatalf("failed importacao = %+v", imp)
	}
	if job, _ := repo.Reivindicar(ctx); job != nil {
		t.Fatalf("queue should be empty, got %+v", job.Importacao)
	}
}
