package planilha

import (
	"bytes"
	"slices"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestNumeroValor(t *testing.T) {
	casos := []struct {
		celula Celula
		valor  float64
		ok     bool
	}{
		// the web's examples (parseNumberCell)
		{Celula{Texto: "4090"}, 4090, true},
		{Celula{Texto: "4090,5"}, 4090.5, true},
		{Celula{Texto: "4.090,50"}, 4090.5, true},
		{Celula{Texto: "4,090.50"}, 4090.5, true},
		{Celula{Texto: "R$ 4.090,50"}, 4090.5, true},
		{Celula{Texto: "17,5%"}, 17.5, true},
		{Celula{Texto: "4.090"}, 4090, true},        // text: pt-BR thousands
		{Celula{Texto: "1.234.567"}, 1234567, true}, // text: pt-BR thousands
		{Celula{Texto: "45.9"}, 45.9, true},         // not 3 digits after the dot: decimal
		{Celula{Texto: "-3"}, -3, true},
		// raw values of numeric xlsx cells
		{Celula{Texto: "4090.5"}, 4090.5, true},
		{Celula{Texto: "1E-3"}, 0.001, true},
		{Celula{Texto: "1.234", Numero: true}, 1.234, true}, // a number cell is never read as thousands
		{Celula{Texto: ""}, 0, false},
		{Celula{Texto: "   "}, 0, false},
		{Celula{Texto: "abc"}, 0, false},
		{Celula{Texto: "1,2,3"}, 0, false},
	}
	for _, c := range casos {
		valor, ok := c.celula.NumeroValor()
		if ok != c.ok || (ok && valor != c.valor) {
			t.Errorf("%+v.NumeroValor() = %v, %v; want %v, %v", c.celula, valor, ok, c.valor, c.ok)
		}
	}
}

func coletar(t *testing.T, nome string, dados []byte) []Linha {
	t.Helper()
	var linhas []Linha
	for l, err := range Ler(nome, dados, 7) {
		if err != nil {
			t.Fatal(err)
		}
		linhas = append(linhas, l)
	}
	return linhas
}

func TestLerXLSX(t *testing.T) {
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	f.SetSheetRow(sheet, "A1", &[]any{"SKU", "Nome", "Categoria", "Custo", "ICMS", "Venda", "Estoque", "Status"})
	f.SetSheetRow(sheet, "A2", &[]any{"SKU-1", "Mouse", "INFORMATICA", 1.234, 18, "4.090", 25, "Ativo"})
	// row 3 left empty on purpose
	f.SetSheetRow(sheet, "A4", &[]any{"SKU-2", "Teclado"})
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}

	linhas := coletar(t, "produtos.XLSX", buf.Bytes())
	numeros := make([]int, len(linhas))
	for i, l := range linhas {
		numeros[i] = l.Numero
	}
	if !slices.Equal(numeros, []int{1, 2, 3, 4}) {
		t.Fatalf("row numbers = %v, want [1 2 3 4] (Excel's, gaps included)", numeros)
	}
	if n := len(linhas[0].Celulas); n != 7 {
		t.Errorf("header has %d cells, want 7 (Status cut)", n)
	}

	custo, icms, venda := linhas[1].Celulas[3], linhas[1].Celulas[4], linhas[1].Celulas[5]
	if v, _ := custo.NumeroValor(); v != 1.234 || !custo.Numero {
		t.Errorf("numeric 1.234 read as %v (Numero=%v), want the decimal", v, custo.Numero)
	}
	if v, _ := icms.NumeroValor(); v != 18 {
		t.Errorf("numeric 18 read as %v", v)
	}
	if v, _ := venda.NumeroValor(); v != 4090 || venda.Numero {
		t.Errorf("text \"4.090\" read as %v (Numero=%v), want pt-BR thousands", v, venda.Numero)
	}
	if len(linhas[2].Celulas) != 0 {
		t.Errorf("empty row has cells %+v", linhas[2].Celulas)
	}
}

func TestLerCSV(t *testing.T) {
	csv := "\xef\xbb\xbfSKU;Nome;Categoria;Custo\r\nSKU-1;\"Mouse; sem fio\";INFORMATICA;\"4.090,50\"\r\n"
	linhas := coletar(t, "produtos.csv", []byte(csv))
	if len(linhas) != 2 {
		t.Fatalf("read %d rows, want 2", len(linhas))
	}
	if got := linhas[0].Celulas[0].Texto; got != "SKU" {
		t.Errorf("first cell = %q, want SKU without the BOM", got)
	}
	if got := linhas[1].Celulas[1].Texto; got != "Mouse; sem fio" {
		t.Errorf("quoted cell = %q", got)
	}
	if v, _ := linhas[1].Celulas[3].NumeroValor(); v != 4090.5 {
		t.Errorf("custo = %v, want 4090.5", v)
	}

	if s := separador([]byte("a,b,c\n")); s != ',' {
		t.Errorf("separador(a,b,c) = %q", s)
	}
	if s := separador([]byte("\"a;b\",c\n")); s != ',' {
		t.Errorf("separador ignores quoted ';': got %q", s)
	}
}

func TestLerFormatoInvalido(t *testing.T) {
	for _, err := range Ler("produtos.xls", []byte("x"), 7) {
		if err != ErrFormato {
			t.Fatalf("err = %v, want ErrFormato", err)
		}
		return
	}
	t.Fatal("no error for .xls")
}
