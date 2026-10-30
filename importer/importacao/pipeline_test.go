package importacao

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"github.com/raulbattistini3-sys/sample-ERP/importer/planilha"
	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

var categoriasTeste = map[string]postgres.Categoria{
	"INFORMATICA": {ID: "cat-info", Nome: "INFORMATICA", Ativo: true},
	"MODA":        {ID: "cat-moda", Nome: "MODA", Ativo: false},
}

func linha(numero int, celulas ...string) planilha.Linha {
	l := planilha.Linha{Numero: numero}
	for _, c := range celulas {
		l.Celulas = append(l.Celulas, planilha.Celula{Texto: c})
	}
	return l
}

func mensagens(r resultadoLinha) []string {
	var m []string
	for _, e := range r.erros {
		m = append(m, e.Mensagem)
	}
	return m
}

func TestValidarLinha(t *testing.T) {
	casos := []struct {
		nome  string
		linha planilha.Linha
		erros []string
	}{
		{"valid, ICMS and venda empty", linha(2, "SKU-1", "Mouse", "informatica", "45,90", "", "", "25"), nil},
		{"empty required", linha(2, "", "", "", "", "", "", ""),
			[]string{"SKU vazio", "Nome vazio", "Categoria vazia", "Valor de custo vazio", "Estoque vazio"}},
		{"unknown and inactive categoria", linha(2, "S", "N", "BRINQUEDOS", "1", "", "", "1"),
			[]string{`Categoria "BRINQUEDOS" não existe`}},
		{"inactive categoria", linha(2, "S", "N", "MODA", "1", "", "", "1"),
			[]string{`Categoria "MODA" não encontrada ou inativa`}},
		{"bad numbers", linha(2, "S", "N", "INFORMATICA", "abc", "-1", "x", "2,5"),
			[]string{`Valor de custo não é um número ("abc")`, "ICMS não pode ser negativo", `Valor de venda não é um número ("x")`, "Estoque precisa ser um número inteiro"}},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			got := mensagens(validarLinha(c.linha, categoriasTeste))
			if strings.Join(got, "|") != strings.Join(c.erros, "|") {
				t.Errorf("errors = %q, want %q", got, c.erros)
			}
		})
	}

	r := validarLinha(linha(2, " SKU-1 ", " Mouse ", "informatica", "R$ 4.090,50", "17,5%", "", "25"), categoriasTeste)
	p := r.produto
	if p.sku != "SKU-1" || p.nome != "Mouse" || p.categoriaID != "cat-info" || p.custo != 4090.5 || p.icms != 17.5 || p.venda != 0 || p.estoque != 25 {
		t.Errorf("produto = %+v", p)
	}
}

// seq turns rows into what planilha.Ler yields.
func seq(linhas ...planilha.Linha) func(func(planilha.Linha, error) bool) {
	return func(yield func(planilha.Linha, error) bool) {
		for _, l := range linhas {
			if !yield(l, nil) {
				return
			}
		}
	}
}

func TestLerEValidarRepetidosEmOrdem(t *testing.T) {
	// many rows and validators, so results arrive out of order; the repeat must still name line 3
	var linhas []planilha.Linha
	linhas = append(linhas, linha(1, "SKU", "Nome", "Categoria"))
	for i := 2; i <= 2000; i++ {
		sku := fmt.Sprintf("SKU-%d", i)
		if i == 3 || i == 1500 || i == 1999 {
			sku = "REPETIDO"
		}
		linhas = append(linhas, linha(i, sku, "N", "INFORMATICA", "1", "", "", "1"))
	}
	linhas = append(linhas, linha(2001), linha(2002, "Total de venda por categoria"), linha(2003, "depois", "do", "total"))

	resultados, err := lerEValidar(context.Background(), seq(linhas...), categoriasTeste, 8, 5000)
	if err != nil {
		t.Fatal(err)
	}
	if len(resultados) != 1999 {
		t.Fatalf("got %d rows, want 1999 (header, blank and totals section skipped)", len(resultados))
	}
	for i, r := range resultados {
		if r.linha != i+2 {
			t.Fatalf("result %d is line %d: not in line order", i, r.linha)
		}
		switch r.linha {
		case 1500, 1999:
			if got := mensagens(r); len(got) != 1 || got[0] != "SKU REPETIDO repetido (já está na linha 3)" {
				t.Errorf("line %d errors = %q", r.linha, got)
			}
		default:
			if len(r.erros) != 0 {
				t.Errorf("line %d errors = %q", r.linha, mensagens(r))
			}
		}
	}
}

func TestLerEValidarFalhas(t *testing.T) {
	var muitas []planilha.Linha
	for i := 1; i <= 11; i++ {
		muitas = append(muitas, linha(i, "S", "N", "INFORMATICA", "1", "", "", "1"))
	}
	_, err := lerEValidar(context.Background(), seq(muitas...), categoriasTeste, 4, 10)
	var falha *falhaPlanilha
	if !errors.As(err, &falha) || falha.mensagem != "Importe no máximo 10 produtos por vez." {
		t.Errorf("11 rows over a max of 10: err = %v", err)
	}

	quebrada := func(yield func(planilha.Linha, error) bool) {
		yield(planilha.Linha{}, errors.New("Não foi possível ler o arquivo .xlsx: zip: not a valid zip file"))
	}
	if _, err := lerEValidar(context.Background(), quebrada, categoriasTeste, 4, 10); !errors.As(err, &falha) {
		t.Errorf("read error: err = %v, want falhaPlanilha", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := lerEValidar(ctx, seq(muitas...), categoriasTeste, 4, 100); !errors.Is(err, context.Canceled) {
		t.Errorf("cancelled ctx: err = %v", err)
	}
}

func TestDiffProduto(t *testing.T) {
	nomes := map[string]string{"c1": "INFORMATICA", "c2": "MODA"}
	antes := postgres.Produto{Nome: "Mouse", SKU: "S", CategoriaID: "c1", ValorDeCusto: 45.9, ICMS: 18, ValorDeVenda: 89.9, QuantidadeEmEstoque: 25, Ativo: false}
	depois := antes
	depois.CategoriaID, depois.ICMS, depois.ValorDeVenda, depois.Ativo = "c2", 17.5, 99.9, true

	campos := diffProduto(antes, depois, nomes)
	want := []postgres.CampoAlterado{
		{Campo: "Categoria", Antes: "INFORMATICA", Depois: "MODA"},
		{Campo: "ICMS", Antes: "18", Depois: "17.5"},
		{Campo: "Valor de venda", Antes: "89,90", Depois: "99,90"},
		{Campo: "Status", Antes: "Inativo", Depois: "Ativo"},
	}
	if fmt.Sprint(campos) != fmt.Sprint(want) {
		t.Errorf("diff = %+v, want %+v", campos, want)
	}
	if got := observacoes(campos[2:3]); got != "Alteração registrada automaticamente. Valor de venda: 89,90 → 99,90" {
		t.Errorf("observacoes = %q", got)
	}
	if got := observacoes([]postgres.CampoAlterado{{Campo: "Nome", Antes: strings.Repeat("á", 600), Depois: strings.Repeat("é", 600)}}); len([]rune(got)) != 1000 || !strings.HasSuffix(got, "…") {
		t.Errorf("long observacoes: %d runes", len([]rune(got)))
	}
	if diffProduto(antes, antes, nomes) != nil {
		t.Error("same product has a diff")
	}
}

// planilhaGrande is an xlsx with n product rows, the way a user would fill the template.
func planilhaGrande(b testing.TB, n int) []byte {
	b.Helper()
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	sw, err := f.NewStreamWriter(sheet)
	if err != nil {
		b.Fatal(err)
	}
	sw.SetRow("A1", []any{"SKU", "Nome", "Categoria", "Valor de custo (R$)", "ICMS (%)", "Valor de venda (R$)", "Estoque"})
	for i := 2; i <= n+1; i++ {
		cell, _ := excelize.CoordinatesToCellName(1, i)
		sw.SetRow(cell, []any{fmt.Sprintf("SKU-%05d", i), fmt.Sprintf("Produto %d", i), "INFORMATICA", "45,90", 18, 89.9, i})
	}
	sw.Flush()
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		b.Fatal(err)
	}
	return buf.Bytes()
}

// go test -bench LerEValidar -benchmem ./importer/importacao/
func BenchmarkLerEValidar(b *testing.B) {
	dados := planilhaGrande(b, 5000)
	for _, validadores := range []int{1, runtime.GOMAXPROCS(0)} {
		b.Run(fmt.Sprintf("validadores=%d", validadores), func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				linhas := planilha.Ler("p.xlsx", dados, numColunas)
				if _, err := lerEValidar(context.Background(), linhas, categoriasTeste, validadores, 5000); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// reading alone, to compare with BenchmarkLerEValidar: the difference is what validation costs
func BenchmarkLer(b *testing.B) {
	dados := planilhaGrande(b, 5000)
	b.ReportAllocs()
	for b.Loop() {
		for _, err := range planilha.Ler("p.xlsx", dados, numColunas) {
			if err != nil {
				b.Fatal(err)
			}
		}
	}
}
