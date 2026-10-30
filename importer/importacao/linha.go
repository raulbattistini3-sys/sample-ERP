// Package importacao turns a claimed spreadsheet into products: read and validate every row, then write
// them all in one transaction, or nothing when any row is wrong. The rules are the web's
// (web/src/features/produtos/utils/productsImport.ts) and the API's (ProductService.importProducts), so
// the same file gets the same outcome and the same messages through either path.
package importacao

import (
	"fmt"
	"math"
	"strings"

	"github.com/raulbattistini3-sys/sample-ERP/importer/planilha"
	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// Columns are read by position, in this order (the same as "Baixar planilha", so an exported file can be
// edited and imported back); anything after Estoque is ignored.
const (
	colSKU = iota
	colNome
	colCategoria
	colCusto
	colICMS
	colVenda
	colEstoque
	numColunas
)

// where the export's totals section starts; reading stops there
const marcadorTotais = "total de venda por categoria"

// produtoLido is a row that passed validation.
type produtoLido struct {
	sku, nome, categoria string
	categoriaID          string
	custo, icms, venda   float64
	estoque              float64
}

type resultadoLinha struct {
	linha   int
	produto produtoLido
	erros   []postgres.ErroLinha
}

// validarLinha checks one row on its own; repeated SKUs need every row and are checked by the collector.
// categorias (by nome) is shared by every validator goroutine without a lock: it is filled before they
// start and only read after, and concurrent reads of a map that nobody writes are safe.
func validarLinha(l planilha.Linha, categorias map[string]postgres.Categoria) resultadoLinha {
	r := resultadoLinha{linha: l.Numero}
	erro := func(campo, mensagem string) {
		r.erros = append(r.erros, postgres.ErroLinha{Linha: int32(l.Numero), Campo: campo, Mensagem: mensagem})
	}
	celula := func(i int) planilha.Celula {
		if i < len(l.Celulas) {
			return l.Celulas[i]
		}
		return planilha.Celula{}
	}
	texto := func(i int) string { return strings.TrimSpace(celula(i).Texto) }

	p := &r.produto
	p.sku = texto(colSKU)
	p.nome = texto(colNome)
	p.categoria = strings.ToUpper(texto(colCategoria))
	if p.sku == "" {
		erro("sku", "SKU vazio")
	}
	if p.nome == "" {
		erro("name", "Nome vazio")
	}
	switch c, ok := categorias[p.categoria]; {
	case p.categoria == "":
		erro("categoria", "Categoria vazia")
	case !ok:
		erro("categoria", fmt.Sprintf("Categoria %q não existe", p.categoria))
	case !c.Ativo:
		erro("categoria", fmt.Sprintf("Categoria %q não encontrada ou inativa", p.categoria))
	default:
		p.categoriaID = c.ID
	}

	numero := func(col int, campo, rotulo string, obrigatorio bool) float64 {
		c := celula(col)
		if c.Vazia() {
			if obrigatorio {
				erro(campo, rotulo+" vazio")
			}
			return 0 // ICMS and Valor de venda default to 0
		}
		v, ok := c.NumeroValor()
		switch {
		case !ok:
			erro(campo, fmt.Sprintf("%s não é um número (%q)", rotulo, strings.TrimSpace(c.Texto)))
		case v < 0:
			erro(campo, rotulo+" não pode ser negativo")
		}
		return v
	}
	p.custo = numero(colCusto, "valor_de_custo", "Valor de custo", true)
	p.icms = numero(colICMS, "icms", "ICMS", false)
	p.venda = numero(colVenda, "valor_de_venda", "Valor de venda", false)
	p.estoque = numero(colEstoque, "quantidade_em_estoque", "Estoque", true)
	if !celula(colEstoque).Vazia() && p.estoque != math.Trunc(p.estoque) {
		erro("quantidade_em_estoque", "Estoque precisa ser um número inteiro")
	}
	return r
}

// ignorada is true for rows that aren't products: blank ones, and the header when it is the first row.
func ignorada(l planilha.Linha) bool {
	vazia := true
	for _, c := range l.Celulas {
		if !c.Vazia() {
			vazia = false
			break
		}
	}
	if vazia {
		return true
	}
	return l.Numero == 1 && primeiraCelula(l) == "sku"
}

// fimDosDados is true at the export's totals section.
func fimDosDados(l planilha.Linha) bool {
	return strings.HasPrefix(primeiraCelula(l), marcadorTotais)
}

func primeiraCelula(l planilha.Linha) string {
	if len(l.Celulas) == 0 {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(l.Celulas[0].Texto))
}
