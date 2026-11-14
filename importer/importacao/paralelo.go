package importacao

import (
	"context"
	"sync"

	"github.com/jackc/pgx/v5"

	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// envio is what a worker made of one batch: the counters and errors to commit, and the batch's own
// writes (senioridades, SAC e-mails) that go in the same transaction as the checkpoint.
type envio struct {
	resultado postgres.Lote
	gravar    func(ctx context.Context, tx pgx.Tx) error // optional
	fatal     error                                      // HubSpot refused the import as a whole
}

type pedaco[T any] struct {
	seq         int
	linhas      []T
	processadas int32 // the row index the checkpoint moves to once this batch is committed
}

type pronto struct {
	seq   int
	envio envio
	err   error
}

// pipeline sends batches to HubSpot from several goroutines at once and sums their results through a
// channel into one goroutine that commits them.
//
// The commits happen in spreadsheet order even when the batches finish out of order: the checkpoint
// (linhas_processadas) is "every row up to here is done", so batch 7 can only be committed after 1..6.
// A batch that finishes early waits in memory; with W workers at most about W batches wait, so memory
// stays bounded by the worker count, not by the spreadsheet.
//
// The HubSpot client paces every call through one shared limiter, so more workers don't break the rate
// limit: they overlap the network latency of one batch with the next.
type pipeline[T any] struct {
	ctx      context.Context
	cancelar context.CancelFunc
	lotes    chan pedaco[T]
	prontos  chan pronto
	workers  sync.WaitGroup
	fim      chan struct{}
	seq      int

	// written by the summing goroutine only, read after fim is closed
	soma  postgres.Lote
	fatal error
	err   error
}

// iniciarPipeline starts `workers` goroutines running enviar and one goroutine committing their results.
func iniciarPipeline[T any](
	ctx context.Context,
	workers int,
	enviar func(ctx context.Context, lote []T, processadas int32) (envio, error),
	commit func(ctx context.Context, e envio) error,
) *pipeline[T] {
	if workers < 1 {
		workers = 1
	}
	ctx, cancelar := context.WithCancel(ctx)
	p := &pipeline[T]{
		ctx: ctx, cancelar: cancelar,
		lotes:   make(chan pedaco[T]),
		prontos: make(chan pronto, workers),
		fim:     make(chan struct{}),
	}

	for range workers {
		p.workers.Go(func() {
			for lote := range p.lotes {
				if ctx.Err() != nil {
					p.prontos <- pronto{seq: lote.seq, err: ctx.Err()}
					continue
				}
				e, err := enviar(ctx, lote.linhas, lote.processadas)
				p.prontos <- pronto{seq: lote.seq, envio: e, err: err}
			}
		})
	}
	go func() {
		p.workers.Wait()
		close(p.prontos)
	}()

	// the summing goroutine: commits in order, adds up the counters, and stops everything on the first error
	go func() {
		defer close(p.fim)
		esperando := make(map[int]pronto)
		proximo := 0
		parado := false
		for r := range p.prontos {
			if parado {
				continue // drain, so the workers never block
			}
			esperando[r.seq] = r
			for {
				r, ok := esperando[proximo]
				if !ok {
					break
				}
				delete(esperando, proximo)
				proximo++
				switch {
				case r.err != nil:
					p.err = r.err
				case r.envio.fatal != nil:
					p.fatal = r.envio.fatal
				default:
					if err := commit(ctx, r.envio); err != nil {
						p.err = err
					} else {
						somar(&p.soma, r.envio.resultado)
						continue
					}
				}
				parado = true
				cancelar()
				break
			}
		}
	}()
	return p
}

// enviar hands one batch to the workers. False means the pipeline stopped (an error or HubSpot refused the
// import): stop reading and call fechar for the reason.
func (p *pipeline[T]) enviar(linhas []T, processadas int32) bool {
	select {
	case p.lotes <- pedaco[T]{seq: p.seq, linhas: linhas, processadas: processadas}:
		p.seq++
		return true
	case <-p.ctx.Done():
		return false
	}
}

// fechar waits for every batch sent so far and returns the sum of the committed ones. fatal is set when
// HubSpot refused the import as a whole; err for anything that should leave it to resume later.
func (p *pipeline[T]) fechar() (soma postgres.Lote, fatal error, err error) {
	close(p.lotes)
	<-p.fim
	p.cancelar()
	return p.soma, p.fatal, p.err
}

func somar(total *postgres.Lote, l postgres.Lote) {
	total.Processadas = l.Processadas
	total.Criadas += l.Criadas
	total.Atualizadas += l.Atualizadas
	total.Falharam += l.Falharam
	total.EmpresasCriadas += l.EmpresasCriadas
}

// empresasResolvidas is the company-name cache shared by the client workers. Two batches naming the same
// new company at the same time must not both create it: the first one resolves it, the other waits.
type empresasResolvidas struct {
	mu    sync.Mutex
	nomes map[string]*resolucao
}

type resolucao struct {
	feito chan struct{}
	id    string
	err   error
}

func novasEmpresasResolvidas() *empresasResolvidas {
	return &empresasResolvidas{nomes: make(map[string]*resolucao)}
}

// resolver returns the company's id, calling achar only once per name at a time. criada is true for the
// caller whose achar created it. A failed name is forgotten, so a later row tries again.
func (c *empresasResolvidas) resolver(ctx context.Context, nome string, achar func() (id string, criada bool, err error)) (string, bool, error) {
	c.mu.Lock()
	if r, ok := c.nomes[nome]; ok {
		c.mu.Unlock()
		select {
		case <-r.feito:
			return r.id, false, r.err
		case <-ctx.Done():
			return "", false, ctx.Err()
		}
	}
	r := &resolucao{feito: make(chan struct{})}
	c.nomes[nome] = r
	c.mu.Unlock()

	id, criada, err := achar()
	r.id, r.err = id, err
	if err != nil {
		c.mu.Lock()
		delete(c.nomes, nome)
		c.mu.Unlock()
	}
	close(r.feito)
	return id, criada, err
}
