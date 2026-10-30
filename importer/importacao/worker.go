package importacao

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"

	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// how long a cancelled import gets to hand its job back on shutdown
const devolverTimeout = 5 * time.Second

type WorkerConfig struct {
	Concorrencia  int           // imports processed at the same time
	Prazo         time.Duration // lease: an import's timeout, and when DevolverTravadas takes it back
	MaxTentativas int32
	Intervalo     time.Duration // fallback queue check and stuck-import sweep
}

type Worker struct {
	pool *pgxpool.Pool
	repo *postgres.Importacoes
	proc *Processador
	cfg  WorkerConfig
}

func NewWorker(pool *pgxpool.Pool, repo *postgres.Importacoes, proc *Processador, cfg WorkerConfig) *Worker {
	return &Worker{pool: pool, repo: repo, proc: proc, cfg: cfg}
}

// Run processes imports until ctx is cancelled:
//
//	escutar   LISTEN importacoes -> acordar (a NOTIFY arrives the moment Criar commits)
//	consumir  x Concorrencia: claim and process until the queue is empty, then wait on acordar or the ticker
//	varrer    DevolverTravadas on the ticker
//
// Nothing here returns an error while ctx is alive: a lost LISTEN connection or a failed claim is logged
// and retried, and the ticker keeps the queue moving meanwhile, so a database hiccup never takes the
// gRPC server down with it.
func (w *Worker) Run(ctx context.Context) error {
	// capacity 1: one pending wake-up is enough, and extra NOTIFYs coalesce instead of blocking escutar
	acordar := make(chan struct{}, 1)

	g, ctx := errgroup.WithContext(ctx)
	g.Go(func() error { w.escutar(ctx, acordar); return nil })
	g.Go(func() error { w.varrer(ctx); return nil })
	for range w.cfg.Concorrencia {
		g.Go(func() error { w.consumir(ctx, acordar); return nil })
	}
	return g.Wait()
}

func sinalizar(acordar chan<- struct{}) {
	select {
	case acordar <- struct{}{}:
	default: // a wake-up is already pending
	}
}

func (w *Worker) consumir(ctx context.Context, acordar chan struct{}) {
	ticker := time.NewTicker(w.cfg.Intervalo)
	defer ticker.Stop()
	for {
		for ctx.Err() == nil {
			job, err := w.repo.Reivindicar(ctx)
			if err != nil {
				if ctx.Err() == nil {
					slog.Error("claiming importacao", "err", err)
				}
				break
			}
			if job == nil {
				break // queue empty
			}
			// pass the wake-up on: one NOTIFY reaches only one consumer, so while this one is busy, the
			// next idle one checks for more work and a burst of uploads spreads across all of them
			sinalizar(acordar)
			w.processar(ctx, job)
		}

		select {
		case <-ctx.Done():
			return
		case <-acordar:
		case <-ticker.C:
		}
	}
}

func (w *Worker) processar(ctx context.Context, job *postgres.Job) {
	log := slog.With("importacao", job.ID, "arquivo", job.NomeArquivo, "tentativa", job.Tentativas)
	inicio := time.Now()

	// never outlive the lease: past it, DevolverTravadas may hand the job to someone else
	jobCtx, cancel := context.WithTimeout(ctx, w.cfg.Prazo)
	defer cancel()

	err := w.proc.Processar(jobCtx, job)
	switch {
	case err == nil:
		log.Info("importacao finished", "duracao", time.Since(inicio))
	case ctx.Err() != nil:
		// shutting down: hand the job back now rather than leaving it for the sweep after the lease
		devCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), devolverTimeout)
		defer cancel()
		if err := w.repo.Devolver(devCtx, job); err != nil {
			log.Error("handing importacao back on shutdown", "err", err)
		} else {
			log.Info("importacao handed back on shutdown")
		}
	case errors.Is(err, postgres.ErrReivindicacaoPerdida):
		log.Warn("importacao was handed to another worker; result dropped", "duracao", time.Since(inicio))
	default:
		// left processando: DevolverTravadas retries it after the lease, up to MaxTentativas
		log.Error("processing importacao", "err", err, "duracao", time.Since(inicio))
	}
}

// escutar keeps one connection LISTENing and turns each NOTIFY into a wake-up, reconnecting with backoff
// when the connection drops.
func (w *Worker) escutar(ctx context.Context, acordar chan<- struct{}) {
	espera := time.Second
	for ctx.Err() == nil {
		err := w.escutarConexao(ctx, acordar)
		if ctx.Err() != nil {
			return
		}
		slog.Warn("LISTEN connection lost; polling meanwhile", "err", err, "retry_in", espera)
		select {
		case <-ctx.Done():
			return
		case <-time.After(espera):
		}
		espera = min(espera*2, w.cfg.Intervalo)
	}
}

func (w *Worker) escutarConexao(ctx context.Context, acordar chan<- struct{}) error {
	conn, err := w.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	// taken out of the pool for good: a connection that LISTENs must not be handed to anyone else
	raw := conn.Hijack()
	defer raw.Close(context.WithoutCancel(ctx))

	if _, err := raw.Exec(ctx, "LISTEN "+postgres.CanalImportacoes); err != nil {
		return err
	}
	// anything queued while we weren't listening
	sinalizar(acordar)
	for {
		if _, err := raw.WaitForNotification(ctx); err != nil {
			return err
		}
		sinalizar(acordar)
	}
}

func (w *Worker) varrer(ctx context.Context) {
	ticker := time.NewTicker(w.cfg.Intervalo)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		devolvidas, falhas, err := w.repo.DevolverTravadas(ctx, w.cfg.Prazo, w.cfg.MaxTentativas)
		switch {
		case err != nil && ctx.Err() == nil:
			slog.Error("sweeping stuck importacoes", "err", err)
		case devolvidas > 0 || falhas > 0:
			slog.Warn("stuck importacoes swept", "devolvidas", devolvidas, "falhas", falhas)
		}
	}
}
