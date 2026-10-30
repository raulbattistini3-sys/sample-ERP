package importacao

import (
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// The texts of an automatic "Alteracao" auditoria, formatted like the API's diffProduct and
// observacoes (api/src/repositories/audit_trail.repository.ts) so both read the same in the pages.

const maxObservacoes = 1000

// dinheiro is JS's value.toFixed(2) with a decimal comma: 4090.5 -> "4090,50"
func dinheiro(v float64) string {
	return strings.Replace(strconv.FormatFloat(v, 'f', 2, 64), ".", ",", 1)
}

// numero is JS's String(Number(value)): 17.5 -> "17.5", 18 -> "18"
func numero(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func situacao(ativo bool) string {
	if ativo {
		return "Ativo"
	}
	return "Inativo"
}

// diffProduto lists the fields that differ, in the API's order and wording; categoriaNome maps a
// categoria id to its nome.
func diffProduto(antes, depois postgres.Produto, categoriaNome map[string]string) []postgres.CampoAlterado {
	var campos []postgres.CampoAlterado
	add := func(campo, a, b string) {
		if a != b {
			campos = append(campos, postgres.CampoAlterado{Campo: campo, Antes: a, Depois: b})
		}
	}
	nome := func(id string) string {
		if n, ok := categoriaNome[id]; ok {
			return n
		}
		return id
	}
	add("Nome", antes.Nome, depois.Nome)
	add("SKU", antes.SKU, depois.SKU)
	add("Categoria", nome(antes.CategoriaID), nome(depois.CategoriaID))
	add("Valor de custo", dinheiro(antes.ValorDeCusto), dinheiro(depois.ValorDeCusto))
	add("ICMS", numero(antes.ICMS), numero(depois.ICMS))
	add("Valor de venda", dinheiro(antes.ValorDeVenda), dinheiro(depois.ValorDeVenda))
	add("Estoque", numero(antes.QuantidadeEmEstoque), numero(depois.QuantidadeEmEstoque))
	add("Status", situacao(antes.Ativo), situacao(depois.Ativo))
	return campos
}

func observacoes(campos []postgres.CampoAlterado) string {
	partes := make([]string, len(campos))
	for i, c := range campos {
		partes[i] = c.Campo + ": " + c.Antes + " → " + c.Depois
	}
	texto := "Alteração registrada automaticamente. " + strings.Join(partes, "; ")
	if utf8.RuneCountInString(texto) <= maxObservacoes {
		return texto
	}
	return string([]rune(texto)[:maxObservacoes-1]) + "…"
}
