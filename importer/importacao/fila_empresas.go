package importacao

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/raulbattistini3-sys/sample-ERP/importer/hubspot"
)

// filaEmpresas resolves the companies named by client rows in batches, instead of one search and one
// create per name. The client workers enqueue names into a circular buffer (a fixed ring guarded by one
// mutex, which blocks the producers while it is full). One goroutine drains it up to hubspot.TamanhoLote
// names at a time, looks them all up with BuscarEmpresas (5 names per search) and creates the missing ones
// with one CriarEmpresas (companies batch/create, available on every HubSpot tier, free included). Each
// name is resolved once per import: a later row naming it waits on the same result. A failed name is
// forgotten, so a later row retries it.
type filaEmpresas struct {
	mu      sync.Mutex
	cheio   *sync.Cond // producers wait here while the ring is full
	vazio   *sync.Cond // the sender waits here while it is empty
	anel    []string   // circular buffer of lowercase names waiting to be sent
	ini, n  int
	fechada bool
	nomes   map[string]*resolucao // lowercase name -> its (pending or done) resolution

	buscar func(ctx context.Context, nomes []string) (map[string]string, error) // lowercase name -> id
	criar  func(ctx context.Context, nomes []string) (map[string]string, error) // lowercase name -> id
	lote   int
	espera time.Duration // how long a partial batch waits for more names before it goes
	fim    chan struct{}
}

type resolucao struct {
	nome   string // as the first row wrote it, used to create the company
	feito  chan struct{}
	id     string
	criada bool
	err    error
}

// novaFilaEmpresas starts the queue's sender; it stops when ctx ends or fechar is called.
func novaFilaEmpresas(ctx context.Context, hs *hubspot.Client, capacidade int) *filaEmpresas {
	return iniciarFilaEmpresas(ctx, capacidade, hubspot.TamanhoLote, 25*time.Millisecond,
		hs.BuscarEmpresas,
		func(ctx context.Context, nomes []string) (map[string]string, error) {
			novas := make([]hubspot.Empresa, len(nomes))
			for i, n := range nomes {
				novas[i] = hubspot.Empresa{Propriedades: map[string]string{"name": n}}
			}
			return hs.CriarEmpresas(ctx, novas)
		})
}

func iniciarFilaEmpresas(
	ctx context.Context, capacidade, lote int, espera time.Duration,
	buscar, criar func(ctx context.Context, nomes []string) (map[string]string, error),
) *filaEmpresas {
	if lote < 1 {
		lote = 1
	}
	if capacidade < lote {
		capacidade = lote
	}
	f := &filaEmpresas{
		anel: make([]string, capacidade), nomes: make(map[string]*resolucao),
		buscar: buscar, criar: criar, lote: lote, espera: espera, fim: make(chan struct{}),
	}
	f.cheio = sync.NewCond(&f.mu)
	f.vazio = sync.NewCond(&f.mu)
	go f.enviar(ctx)
	// a cancelled import wakes everyone up instead of leaving them waiting on the ring
	go func() {
		select {
		case <-ctx.Done():
			f.fechar()
		case <-f.fim:
		}
	}()
	return f
}

// resolver returns lowercase name -> id for the given company names, and how many of them this call
// created (each new company is counted once, by the call that enqueued it). Per-name failures come back in
// erros; err is set only when HubSpot refused the import as a whole or ctx ended.
func (f *filaEmpresas) resolver(ctx context.Context, nomes []string) (ids map[string]string, criadas int, erros map[string]error, err error) {
	minhas := make(map[string]bool, len(nomes))
	todas := make(map[string]*resolucao, len(nomes))
	f.mu.Lock()
	for _, nome := range nomes {
		chave := strings.ToLower(strings.TrimSpace(nome))
		if chave == "" || todas[chave] != nil {
			continue
		}
		// Wait releases the lock, so another worker may enqueue this same name meanwhile: check again after it
		for f.nomes[chave] == nil && f.n == len(f.anel) && !f.fechada {
			f.cheio.Wait()
		}
		if r, ok := f.nomes[chave]; ok {
			todas[chave] = r
			continue
		}
		if f.fechada {
			f.mu.Unlock()
			if ctx.Err() != nil {
				return nil, 0, nil, ctx.Err()
			}
			return nil, 0, nil, context.Canceled
		}
		r := &resolucao{nome: strings.TrimSpace(nome), feito: make(chan struct{})}
		f.nomes[chave] = r
		f.anel[(f.ini+f.n)%len(f.anel)] = chave
		f.n++
		f.vazio.Signal()
		todas[chave], minhas[chave] = r, true
	}
	f.mu.Unlock()

	ids = make(map[string]string, len(todas))
	for chave, r := range todas {
		select {
		case <-r.feito:
		case <-ctx.Done():
			return nil, 0, nil, ctx.Err()
		}
		switch {
		case r.err != nil && (hubspot.Fatal(r.err) || ctx.Err() != nil):
			return nil, 0, nil, r.err
		case r.err != nil:
			if erros == nil {
				erros = make(map[string]error)
			}
			erros[chave] = r.err
		default:
			ids[chave] = r.id
			if r.criada && minhas[chave] {
				criadas++
			}
		}
	}
	return ids, criadas, erros, nil
}

// fechar lets the sender finish what is already queued, then stop; waiting producers give up.
func (f *filaEmpresas) fechar() {
	f.mu.Lock()
	f.fechada = true
	f.cheio.Broadcast()
	f.vazio.Broadcast()
	f.mu.Unlock()
}

// enviar is the ring's only consumer: it drains it a batch at a time until it is closed and empty.
func (f *filaEmpresas) enviar(ctx context.Context) {
	defer close(f.fim)
	for {
		f.mu.Lock()
		for f.n == 0 && !f.fechada {
			f.vazio.Wait()
		}
		if f.n == 0 {
			f.mu.Unlock()
			return
		}
		if f.n < f.lote && !f.fechada && f.espera > 0 {
			// a partial batch: give the other workers a moment to fill it
			f.mu.Unlock()
			select {
			case <-time.After(f.espera):
			case <-ctx.Done():
			}
			f.mu.Lock()
		}
		k := min(f.n, f.lote)
		chaves := make([]string, k)
		lote := make([]*resolucao, k)
		for i := range k {
			chaves[i] = f.anel[f.ini]
			f.anel[f.ini] = ""
			f.ini = (f.ini + 1) % len(f.anel)
			lote[i] = f.nomes[chaves[i]]
		}
		f.n -= k
		f.cheio.Broadcast()
		f.mu.Unlock()

		f.resolverLote(ctx, chaves, lote)
	}
}

func (f *filaEmpresas) resolverLote(ctx context.Context, chaves []string, lote []*resolucao) {
	terminar := func(i int, id string, criada bool, err error) {
		r := lote[i]
		r.id, r.criada, r.err = id, criada, err
		if err != nil {
			f.mu.Lock()
			delete(f.nomes, chaves[i])
			f.mu.Unlock()
		}
		close(r.feito)
	}
	falharTodas := func(err error) {
		for i := range lote {
			terminar(i, "", false, err)
		}
	}
	if err := ctx.Err(); err != nil {
		falharTodas(err)
		return
	}

	nomes := make([]string, len(lote))
	for i, r := range lote {
		nomes[i] = r.nome
	}
	achadas, err := f.buscar(ctx, nomes)
	if err != nil {
		falharTodas(err)
		return
	}
	var faltam []int
	for i, chave := range chaves {
		if id, ok := achadas[chave]; ok {
			terminar(i, id, false, nil)
		} else {
			faltam = append(faltam, i)
		}
	}
	if len(faltam) == 0 {
		return
	}

	novos := make([]string, len(faltam))
	for j, i := range faltam {
		novos[j] = lote[i].nome
	}
	criadas, err := f.criar(ctx, novos)
	if err != nil && !hubspot.Fatal(err) && ctx.Err() == nil && len(faltam) > 1 {
		// HubSpot rejects a whole batch over one invalid value: one by one, so the others still go in
		for _, i := range faltam {
			um, err := f.criar(ctx, []string{lote[i].nome})
			if err == nil && um[chaves[i]] == "" {
				err = errSemID
			}
			terminar(i, um[chaves[i]], err == nil, err)
		}
		return
	}
	for _, i := range faltam {
		switch id := criadas[chaves[i]]; {
		case err != nil:
			terminar(i, "", false, err)
		case id == "":
			terminar(i, "", false, errSemID)
		default:
			terminar(i, id, true, nil)
		}
	}
}

type erroTexto string

func (e erroTexto) Error() string { return string(e) }

const errSemID = erroTexto("o HubSpot não devolveu o id da empresa criada")
