package importacao

import (
	"context"
	"errors"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// batches finish out of order (random delays) but are committed in order, and the counters add up
func TestPipelineCommitsInOrderAndSums(t *testing.T) {
	var commits []int32
	p := iniciarPipeline(context.Background(), 4,
		func(ctx context.Context, lote []int, processadas int32) (envio, error) {
			time.Sleep(time.Duration(rand.IntN(5)) * time.Millisecond)
			return envio{resultado: postgres.Lote{Processadas: processadas, Criadas: int32(len(lote)), Falharam: 1}}, nil
		},
		func(ctx context.Context, e envio) error {
			commits = append(commits, e.resultado.Processadas) // the summing goroutine is the only caller
			return nil
		},
	)
	for i := range 50 {
		if !p.enviar([]int{1, 2, 3}, int32((i+1)*3)) {
			t.Fatal("pipeline stopped")
		}
	}
	soma, fatal, err := p.fechar()
	if fatal != nil || err != nil {
		t.Fatal(fatal, err)
	}
	if len(commits) != 50 {
		t.Fatalf("commits = %d", len(commits))
	}
	for i, c := range commits {
		if c != int32((i+1)*3) {
			t.Fatalf("commit %d has checkpoint %d: out of order", i, c)
		}
	}
	if soma.Criadas != 150 || soma.Falharam != 50 || soma.Processadas != 150 {
		t.Fatalf("soma = %+v", soma)
	}
}

// a fatal batch stops everything: nothing after it is committed and the reader is told to stop
func TestPipelineStopsOnFatal(t *testing.T) {
	recusado := errors.New("hubspot: not connected")
	var commits atomic.Int32
	p := iniciarPipeline(context.Background(), 3,
		func(ctx context.Context, lote []int, processadas int32) (envio, error) {
			if processadas == 3 {
				return envio{fatal: recusado}, nil
			}
			return envio{resultado: postgres.Lote{Processadas: processadas}}, nil
		},
		func(ctx context.Context, e envio) error {
			if e.resultado.Processadas >= 3 {
				t.Errorf("committed batch %d after the fatal one", e.resultado.Processadas)
			}
			commits.Add(1)
			return nil
		},
	)
	parou := false
	for i := 1; i <= 1000; i++ {
		if !p.enviar([]int{i}, int32(i)) {
			parou = true
			break
		}
	}
	_, fatal, err := p.fechar()
	if !errors.Is(fatal, recusado) || err != nil {
		t.Fatalf("fatal=%v err=%v", fatal, err)
	}
	if !parou {
		t.Fatal("the reader was never told to stop")
	}
	if commits.Load() != 2 {
		t.Fatalf("commits = %d, want 2", commits.Load())
	}
}

// two workers asking for the same new company at once: only one creates it
func TestEmpresasResolvidasCreatesOnce(t *testing.T) {
	c := novasEmpresasResolvidas()
	var chamadas, criadas atomic.Int32
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			_, criada, err := c.resolver(context.Background(), "acme", func() (string, bool, error) {
				chamadas.Add(1)
				time.Sleep(5 * time.Millisecond)
				return "123", true, nil
			})
			if err != nil {
				t.Error(err)
			}
			if criada {
				criadas.Add(1)
			}
		})
	}
	wg.Wait()
	if chamadas.Load() != 1 || criadas.Load() != 1 {
		t.Fatalf("chamadas=%d criadas=%d", chamadas.Load(), criadas.Load())
	}
}
