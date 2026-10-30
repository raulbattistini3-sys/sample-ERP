package importacao

import (
	"context"
	"errors"
	"runtime"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/raulbattistini3-sys/sample-ERP/importer/planilha"
	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

const pgUniqueViolation = "23505"

type Processador struct {
	pool      *pgxpool.Pool
	repo      *postgres.Importacoes
	maxLinhas int
	// Validation is CPU work, so at most one goroutine per core. Measured (BenchmarkLer vs
	// BenchmarkLerEValidar, 5000 rows): reading the xlsx is ~70% of the time and 1 vs 8 validators is
	// within noise, so this is not the knob to turn; the reader is.
	validadores int
	agora       func() time.Time
}

func NewProcessador(pool *pgxpool.Pool, repo *postgres.Importacoes, maxLinhas int) *Processador {
	return &Processador{
		pool:        pool,
		repo:        repo,
		maxLinhas:   maxLinhas,
		validadores: runtime.GOMAXPROCS(0),
		agora:       time.Now,
	}
}

// Processar takes a claimed job to its final status. A spreadsheet that can't be read fails, one with any
// invalid row is rejected with every row's errors, and a valid one is written and concluded in a single
// transaction. A returned error means the job was not finalized (database trouble, ctx cancelled, or
// postgres.ErrReivindicacaoPerdida); it stays processando and DevolverTravadas retries it later.
func (p *Processador) Processar(ctx context.Context, job *postgres.Job) error {
	lista, err := postgres.Categorias(ctx, p.pool)
	if err != nil {
		return err
	}
	categorias := make(map[string]postgres.Categoria, len(lista))
	for _, c := range lista {
		categorias[c.Nome] = c
	}

	linhas := planilha.Ler(job.NomeArquivo, job.Planilha, numColunas)
	resultados, err := lerEValidar(ctx, linhas, categorias, p.validadores, p.maxLinhas)
	var falha *falhaPlanilha
	switch {
	case errors.As(err, &falha):
		return p.finalizar(ctx, job, postgres.Resultado{Status: postgres.StatusFalhou, Mensagem: falha.mensagem})
	case err != nil:
		return err
	case len(resultados) == 0:
		return p.finalizar(ctx, job, postgres.Resultado{Status: postgres.StatusFalhou, Mensagem: "A planilha não tem nenhum produto."})
	}

	var erros []postgres.ErroLinha
	for _, r := range resultados {
		erros = append(erros, r.erros...)
	}
	total := int32(len(resultados))
	if len(erros) > 0 {
		return p.finalizar(ctx, job, postgres.Resultado{Status: postgres.StatusRejeitada, TotalLinhas: total, Erros: erros})
	}

	err = pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		criadas, atualizadas, err := p.gravar(ctx, tx, job.UsuarioID, resultados, lista)
		if err != nil {
			return err
		}
		return p.repo.Finalizar(ctx, tx, job, postgres.Resultado{
			Status: postgres.StatusConcluida, TotalLinhas: total, LinhasCriadas: criadas, LinhasAtualizadas: atualizadas,
		})
	})
	if pgCode(err) == pgUniqueViolation {
		// another import or the API created one of these SKUs between our lock and our COPY
		return p.finalizar(ctx, job, postgres.Resultado{
			Status:      postgres.StatusRejeitada,
			TotalLinhas: total,
			Mensagem:    "Um dos SKUs da planilha foi cadastrado enquanto ela era importada; importe de novo",
		})
	}
	return err
}

func (p *Processador) finalizar(ctx context.Context, job *postgres.Job, res postgres.Resultado) error {
	return p.repo.Finalizar(ctx, p.pool, job, res)
}

// gravar splits the rows by SKU: an existing product is updated (and reactivated) with an auditoria when
// something changed, a new SKU is created. The existing ones stay locked until the transaction ends.
// Like the API, every row matching an existing SKU counts as updated, changed or not.
func (p *Processador) gravar(ctx context.Context, tx pgx.Tx, usuarioID string, resultados []resultadoLinha, categorias []postgres.Categoria) (criadas, atualizadas int32, err error) {
	skus := make([]string, len(resultados))
	for i, r := range resultados {
		skus[i] = r.produto.sku
	}
	existentes, err := postgres.TravarPorSKU(ctx, tx, skus)
	if err != nil {
		return 0, 0, err
	}
	categoriaNome := make(map[string]string, len(categorias))
	for _, c := range categorias {
		categoriaNome[c.ID] = c.Nome
	}

	var novos []postgres.Produto
	var alteracoes []postgres.Alteracao
	for _, r := range resultados {
		depois := postgres.Produto{
			Nome:                r.produto.nome,
			SKU:                 r.produto.sku,
			CategoriaID:         r.produto.categoriaID,
			ValorDeCusto:        r.produto.custo,
			ICMS:                r.produto.icms,
			ValorDeVenda:        r.produto.venda,
			QuantidadeEmEstoque: r.produto.estoque,
			Ativo:               true,
		}
		antes, existe := existentes[depois.SKU]
		if !existe {
			novos = append(novos, depois)
			continue
		}
		depois.ID = antes.ID
		campos := diffProduto(antes, depois, categoriaNome)
		if len(campos) == 0 {
			continue // same values: the API's UPDATE would change nothing and record no auditoria
		}
		alteracoes = append(alteracoes, postgres.Alteracao{
			Depois:      depois,
			Campos:      campos,
			VendaAntes:  strconv.FormatFloat(antes.ValorDeVenda, 'f', 2, 64),
			VendaDepois: strconv.FormatFloat(depois.ValorDeVenda, 'f', 2, 64),
			Observacoes: observacoes(campos),
		})
	}

	if len(novos) > 0 {
		if _, err := postgres.InserirProdutos(ctx, tx, novos, p.agora()); err != nil {
			return 0, 0, err
		}
	}
	if len(alteracoes) > 0 {
		if err := postgres.AtualizarAuditados(ctx, tx, usuarioID, alteracoes); err != nil {
			return 0, 0, err
		}
	}
	return int32(len(novos)), int32(len(resultados) - len(novos)), nil
}

func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}
