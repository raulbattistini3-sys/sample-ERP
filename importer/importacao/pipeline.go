package importacao

import (
	"context"
	"fmt"
	"iter"
	"slices"
	"sync"

	"golang.org/x/sync/errgroup"

	"github.com/raulbattistini3-sys/sample-ERP/importer/planilha"
	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// falhaPlanilha is a problem with the file as a whole (unreadable, too many rows); the import fails
// with its message instead of a list of row errors.
type falhaPlanilha struct{ mensagem string }

func (f *falhaPlanilha) Error() string { return f.mensagem }

// lerEValidar runs the spreadsheet through three stages:
//
//	reader (1 goroutine: the file is read in order) -> linhas -> validators (n) -> resultados -> collector
//
// The buffered channels are the ring buffers between stages: the reader can only get cap(linhas) rows
// ahead of the validators, so memory stays flat however big the file is. Any error, or ctx being
// cancelled, stops every stage (errgroup cancels the shared ctx and each send also selects on it).
// Results come back in line order, with repeated SKUs flagged.
func lerEValidar(ctx context.Context, linhas iter.Seq2[planilha.Linha, error], categorias map[string]postgres.Categoria, validadores, maxLinhas int) ([]resultadoLinha, error) {
	g, ctx := errgroup.WithContext(ctx)
	paraValidar := make(chan planilha.Linha, 256)
	validadas := make(chan resultadoLinha, 256)

	g.Go(func() error {
		defer close(paraValidar)
		lidas := 0
		for l, err := range linhas {
			if err != nil {
				return &falhaPlanilha{err.Error()}
			}
			if fimDosDados(l) {
				return nil
			}
			if ignorada(l) {
				continue
			}
			if lidas++; lidas > maxLinhas {
				return &falhaPlanilha{fmt.Sprintf("Importe no máximo %d produtos por vez.", maxLinhas)}
			}
			select {
			case paraValidar <- l:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	})

	var wg sync.WaitGroup
	for range validadores {
		wg.Go(func() {
			for l := range paraValidar {
				select {
				case validadas <- validarLinha(l, categorias):
				case <-ctx.Done():
					return
				}
			}
		})
	}
	// validadas closes once every validator is done, which ends the collector's range below
	go func() {
		wg.Wait()
		close(validadas)
	}()

	var resultados []resultadoLinha
	for r := range validadas {
		resultados = append(resultados, r)
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}

	// validators finish out of order; "já está na linha X" must name the first occurrence
	slices.SortFunc(resultados, func(a, b resultadoLinha) int { return a.linha - b.linha })
	marcarSKUsRepetidos(resultados)
	return resultados, nil
}

// marcarSKUsRepetidos flags every row whose SKU already appeared on an earlier one: O(n) with a map
// from SKU to its first line, instead of comparing every pair. Like the web, a row with other errors
// still claims its SKU.
func marcarSKUsRepetidos(resultados []resultadoLinha) {
	primeiraLinha := make(map[string]int, len(resultados))
	for i := range resultados {
		r := &resultados[i]
		sku := r.produto.sku
		if sku == "" {
			continue
		}
		if primeira, repetido := primeiraLinha[sku]; repetido {
			r.erros = append(r.erros, postgres.ErroLinha{
				Linha:    int32(r.linha),
				Campo:    "sku",
				Mensagem: fmt.Sprintf("SKU %s repetido (já está na linha %d)", sku, primeira),
			})
			continue
		}
		primeiraLinha[sku] = r.linha
	}
}
