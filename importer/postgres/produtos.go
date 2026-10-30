package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// The product writes of an import, matching the API's (api/src/repositories/product.repository.ts and
// audit_trail.repository.ts) so a spreadsheet imported here or through POST /products/import ends up
// the same: creates are plain inserts, every update that changes something gets an "Alteracao"
// auditoria (or claims a matching manual one) and the integration envios for it.

type Categoria struct {
	ID    string
	Nome  string
	Ativo bool
}

func Categorias(ctx context.Context, db DBTX) ([]Categoria, error) {
	rows, err := db.Query(ctx, `SELECT id, nome::text, ativo FROM categorias`)
	if err != nil {
		return nil, fmt.Errorf("postgres: reading categorias: %w", err)
	}
	categorias, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Categoria, error) {
		var c Categoria
		err := row.Scan(&c.ID, &c.Nome, &c.Ativo)
		return c, err
	})
	if err != nil {
		return nil, fmt.Errorf("postgres: reading categorias: %w", err)
	}
	return categorias, nil
}

// Produto holds the columns an import writes and compares.
type Produto struct {
	ID                  string
	Nome                string
	SKU                 string
	CategoriaID         string
	ValorDeCusto        float64
	ICMS                float64
	ValorDeVenda        float64
	QuantidadeEmEstoque float64
	Ativo               bool
}

// TravarPorSKU reads and locks (FOR UPDATE) the products with these SKUs until the transaction ends, so
// nothing changes them between the comparison and the write. Rows are locked in sku order: two imports
// sharing SKUs take the locks in the same order and wait for each other instead of deadlocking.
func TravarPorSKU(ctx context.Context, tx pgx.Tx, skus []string) (map[string]Produto, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, name, sku, categoria_id, valor_de_custo::float8, icms, valor_de_venda::float8, quantidade_em_estoque, ativo
		FROM produtos
		WHERE sku = ANY($1)
		ORDER BY sku
		FOR UPDATE`, skus)
	if err != nil {
		return nil, fmt.Errorf("postgres: locking produtos: %w", err)
	}
	porSKU := make(map[string]Produto, len(skus))
	var p Produto
	_, err = pgx.ForEachRow(rows, []any{
		&p.ID, &p.Nome, &p.SKU, &p.CategoriaID, &p.ValorDeCusto, &p.ICMS, &p.ValorDeVenda, &p.QuantidadeEmEstoque, &p.Ativo,
	}, func() error {
		porSKU[p.SKU] = p
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("postgres: locking produtos: %w", err)
	}
	return porSKU, nil
}

// InserirProdutos creates the products with COPY: one round trip for the whole batch instead of an
// INSERT per row. All of them are active, registered at dataDeCadastro.
func InserirProdutos(ctx context.Context, tx pgx.Tx, produtos []Produto, dataDeCadastro time.Time) (int64, error) {
	n, err := tx.CopyFrom(ctx,
		pgx.Identifier{"produtos"},
		[]string{"name", "ativo", "sku", "categoria_id", "valor_de_custo", "icms", "valor_de_venda", "data_de_cadastro", "quantidade_em_estoque"},
		pgx.CopyFromSlice(len(produtos), func(i int) ([]any, error) {
			p := produtos[i]
			return []any{p.Nome, true, p.SKU, p.CategoriaID, p.ValorDeCusto, p.ICMS, p.ValorDeVenda, dataDeCadastro, p.QuantidadeEmEstoque}, nil
		}))
	if err != nil {
		return 0, fmt.Errorf("postgres: inserting produtos: %w", err)
	}
	return n, nil
}

type CampoAlterado struct {
	Campo  string `json:"campo"`
	Antes  string `json:"antes"`
	Depois string `json:"depois"`
}

// Alteracao is one product update and the auditoria that describes it.
type Alteracao struct {
	Depois      Produto // every editable column, as saved
	Campos      []CampoAlterado
	VendaAntes  string // valor de venda before/after, "%.2f": how a manual auditoria is matched
	VendaDepois string
	Observacoes string
}

// AtualizarAuditados applies the updates and records their auditorias, all in one pipelined batch:
// a single round trip however many products changed. The statements still run one after another on
// the transaction, so each sees the previous ones (a manual auditoria claimed for one product can't be
// claimed again for the next).
func AtualizarAuditados(ctx context.Context, tx pgx.Tx, usuarioID string, alteracoes []Alteracao) error {
	var lote string
	if err := tx.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&lote); err != nil {
		return fmt.Errorf("postgres: starting lote: %w", err)
	}
	batch := &pgx.Batch{}
	for _, a := range alteracoes {
		campos, err := json.Marshal(a.Campos)
		if err != nil {
			return fmt.Errorf("postgres: encoding alteracoes: %w", err)
		}
		p := a.Depois
		batch.Queue(`
			UPDATE produtos
			SET name = $2, sku = $3, categoria_id = $4, valor_de_custo = $5, icms = $6, valor_de_venda = $7,
				quantidade_em_estoque = $8, ativo = $9
			WHERE id = $1`,
			p.ID, p.Nome, p.SKU, p.CategoriaID, p.ValorDeCusto, p.ICMS, p.ValorDeVenda, p.QuantidadeEmEstoque, p.Ativo)
		batch.Queue(registrarAlteracao, p.ID, a.VendaAntes, a.VendaDepois, p.Nome, a.Observacoes, campos, usuarioID, lote)
	}

	results := tx.SendBatch(ctx, batch)
	for i := range batch.Len() {
		if _, err := results.Exec(); err != nil {
			results.Close()
			return fmt.Errorf("postgres: updating produto %s: %w", alteracoes[i/2].Depois.SKU, err)
		}
	}
	if err := results.Close(); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, resumirLote, lote); err != nil {
		return fmt.Errorf("postgres: summing up lote: %w", err)
	}
	return nil
}

// recordProductChange (audit_trail.repository.ts) as one statement: claim the oldest unused manual
// "Alteracao" auditoria from the last 24 hours for this product with the same valor de venda
// before/after; when there is none, create an automatic one in this lote, already vinculada, with its
// detalhamento and product link.
const registrarAlteracao = `
WITH reivindicada AS (
	UPDATE auditorias SET vinculada_em = now()
	WHERE id = (
		SELECT a.id
		FROM auditorias a
		JOIN produtos_por_auditoria pa ON pa.auditoria_id = a.id
		JOIN detalhamentos_auditoria d ON d.id = a.detalhamento_auditoria_id
		WHERE pa.produto_id = $1::uuid
			AND a.acao_efetuada = 'Alteracao'
			AND a.deleted_at IS NULL
			AND a.vinculada_em IS NULL
			AND a.criada_em > now() - interval '24 hours'
			AND d.valor_anterior = $2::numeric
			AND d.valor_atual = $3::numeric
		ORDER BY a.criada_em
		LIMIT 1
		FOR UPDATE OF a SKIP LOCKED
	)
	RETURNING id
),
detalhamento AS (
	INSERT INTO detalhamentos_auditoria (nome_do_produto, valor_anterior, valor_atual, observacoes_adicionais, alteracoes)
	SELECT $4::text, $2::numeric, $3::numeric, $5::text, $6::jsonb
	WHERE NOT EXISTS (SELECT 1 FROM reivindicada)
	RETURNING id
),
auditoria AS (
	INSERT INTO auditorias (acao_efetuada, data_de_audicao, usuario_id, detalhamento_auditoria_id, vinculada_em, lote_id)
	SELECT 'Alteracao', now(), $7::uuid, id, now(), $8::uuid FROM detalhamento
	RETURNING id
)
INSERT INTO produtos_por_auditoria (auditoria_id, produto_id)
SELECT id, $1::uuid FROM auditoria`

// enqueueForLote (integracao_envios.repository.ts): one envio per categoria and connected integration
// summing the lote up, with no resumo for a single change (job_id stays NULL: the API's
// IntegracaoEnvioWorker sweep gives it its pg-boss job).
const resumirLote = `
WITH alteracoes AS (
	SELECT a.id AS auditoria_id, c.id AS categoria_id, c.nome::text AS categoria_nome,
		d.valor_atual > d.valor_anterior AS aumento, d.valor_atual < d.valor_anterior AS reducao,
		d.alteracoes @> '[{"campo": "ICMS"}]'::jsonb AS icms
	FROM auditorias a
	JOIN detalhamentos_auditoria d ON d.id = a.detalhamento_auditoria_id
	JOIN produtos_por_auditoria pa ON pa.auditoria_id = a.id
	JOIN produtos p ON p.id = pa.produto_id
	JOIN categorias c ON c.id = p.categoria_id
	WHERE a.lote_id = $1::uuid
),
por_categoria AS (
	SELECT categoria_id, categoria_nome, (array_agg(auditoria_id))[1] AS auditoria_id, count(*) AS total,
		count(*) FILTER (WHERE aumento) AS aumentos, count(*) FILTER (WHERE reducao) AS reducoes,
		count(*) FILTER (WHERE icms) AS icms, count(*) FILTER (WHERE NOT aumento AND NOT reducao AND NOT icms) AS outras
	FROM alteracoes GROUP BY categoria_id, categoria_nome
)
INSERT INTO auditoria_integracao_envios (auditoria_id, categoria_id, categoria_nome, provider, lote_id, resumo)
SELECT l.auditoria_id, l.categoria_id, l.categoria_nome, i.provider, $1::uuid,
	CASE WHEN l.total > 1 THEN jsonb_build_object('total', l.total, 'aumentos', l.aumentos, 'reducoes', l.reducoes, 'icms', l.icms, 'outras', l.outras) END
FROM por_categoria l CROSS JOIN integracoes i
WHERE (i.provider = 'jira' AND i.config ->> 'projectKey' IS NOT NULL AND i.config ->> 'issueTypeId' IS NOT NULL)
	OR (i.provider = 'hubspot' AND i.config ->> 'pipelineId' IS NOT NULL AND i.config ->> 'stageId' IS NOT NULL)
ON CONFLICT (auditoria_id, categoria_id, provider) DO NOTHING`
