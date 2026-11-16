package importacao

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type hubspotFalso struct {
	mu        sync.Mutex
	existem   map[string]string
	buscas    atomic.Int32
	maiorLote int
	recusar   string // a name whose batch create is rejected
}

func (h *hubspotFalso) buscar(ctx context.Context, nomes []string) (map[string]string, error) {
	h.buscas.Add(1)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.maiorLote = max(h.maiorLote, len(nomes))
	out := map[string]string{}
	for _, n := range nomes {
		if id, ok := h.existem[strings.ToLower(n)]; ok {
			out[strings.ToLower(n)] = id
		}
	}
	return out, nil
}

func (h *hubspotFalso) criar(ctx context.Context, nomes []string) (map[string]string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, n := range nomes {
		if h.recusar != "" && strings.EqualFold(n, h.recusar) {
			return nil, errors.New("invalid name")
		}
	}
	out := map[string]string{}
	for _, n := range nomes {
		id := "id-" + strings.ToLower(n)
		h.existem[strings.ToLower(n)] = id
		out[strings.ToLower(n)] = id
	}
	return out, nil
}

// many workers naming overlapping companies: each name is searched and created once, in batches, and
// every new company is counted exactly once
func TestFilaEmpresasBatchesAndCreatesOnce(t *testing.T) {
	h := &hubspotFalso{existem: map[string]string{"velha": "id-velha"}}
	f := iniciarFilaEmpresas(context.Background(), 16, 10, time.Millisecond, h.buscar, h.criar)
	defer f.fechar()

	var criadas atomic.Int32
	var wg sync.WaitGroup
	for w := range 8 {
		wg.Go(func() {
			nomes := []string{"Velha", "velha"}
			for i := range 30 {
				nomes = append(nomes, fmt.Sprintf("Empresa %d", i+w))
			}
			ids, n, erros, err := f.resolver(context.Background(), nomes)
			if err != nil || len(erros) > 0 {
				t.Error(err, erros)
				return
			}
			if ids["velha"] != "id-velha" || ids[strings.ToLower(nomes[2])] == "" {
				t.Errorf("ids = %v", ids)
			}
			criadas.Add(int32(n))
		})
	}
	wg.Wait()
	if criadas.Load() != 37 { // Empresa 0..36
		t.Fatalf("criadas = %d, want 37", criadas.Load())
	}
	if h.maiorLote > 10 {
		t.Fatalf("a batch had %d names, over the batch size", h.maiorLote)
	}
	if h.buscas.Load() >= 38 {
		t.Fatalf("buscas = %d: names were not batched", h.buscas.Load())
	}
}

// one invalid name makes HubSpot reject the batch: the others are still created one by one
func TestFilaEmpresasFallbackOneByOne(t *testing.T) {
	h := &hubspotFalso{existem: map[string]string{}, recusar: "ruim"}
	f := iniciarFilaEmpresas(context.Background(), 8, 8, 0, h.buscar, h.criar)
	defer f.fechar()
	ids, n, erros, err := f.resolver(context.Background(), []string{"boa", "ruim", "outra"})
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 || ids["boa"] == "" || ids["outra"] == "" || erros["ruim"] == nil {
		t.Fatalf("n=%d ids=%v erros=%v", n, ids, erros)
	}
	// the failed name is forgotten: a later call tries it again
	h.mu.Lock()
	h.recusar = ""
	h.mu.Unlock()
	ids, n, _, err = f.resolver(context.Background(), []string{"ruim"})
	if err != nil || n != 1 || ids["ruim"] == "" {
		t.Fatalf("retry: n=%d ids=%v err=%v", n, ids, err)
	}
}

// a cancelled import releases producers blocked on a full ring
func TestFilaEmpresasCancelUnblocks(t *testing.T) {
	ctx, cancelar := context.WithCancel(context.Background())
	lenta := func(ctx context.Context, nomes []string) (map[string]string, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	f := iniciarFilaEmpresas(ctx, 2, 1, 0, lenta, lenta)
	feito := make(chan error, 1)
	go func() {
		_, _, _, err := f.resolver(ctx, []string{"a", "b", "c", "d", "e"})
		feito <- err
	}()
	time.Sleep(10 * time.Millisecond)
	cancelar()
	select {
	case err := <-feito:
		if err == nil {
			t.Fatal("want an error after cancel")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("producer still blocked after cancel")
	}
}
