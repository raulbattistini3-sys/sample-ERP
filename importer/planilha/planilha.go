// Package planilha reads the first sheet of a .xlsx, or a .csv, as rows of cells, streaming: only the
// current row is held in memory, however big the file. It knows nothing about products; see importacao.
package planilha

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"iter"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/xuri/excelize/v2"
)

// Celula is one cell. Numero marks a cell the spreadsheet stored as a number although its raw value
// looks like a pt-BR thousands number ("1.234"); it is only looked up for those, the one case where it
// changes the reading (see NumeroValor). A .csv has no types, so there it is always false.
type Celula struct {
	Texto  string
	Numero bool
}

// Linha is one row; Numero is the row number Excel shows (1-based, header included).
type Linha struct {
	Numero  int
	Celulas []Celula
}

var ErrFormato = errors.New("Formato não suportado. Envie um arquivo .csv ou .xlsx (o .xls antigo não é aceito).")

// Ler picks the reader by extension and yields the rows in order, stopping at the first read error.
// maxColunas cells are kept per row (the rest are ignored), so a wide sheet costs nothing extra.
func Ler(nomeArquivo string, dados []byte, maxColunas int) iter.Seq2[Linha, error] {
	switch strings.ToLower(filepath.Ext(nomeArquivo)) {
	case ".xlsx":
		return lerXLSX(dados, maxColunas)
	case ".csv":
		return lerCSV(dados, maxColunas)
	default:
		return func(yield func(Linha, error) bool) { yield(Linha{}, ErrFormato) }
	}
}

// a text cell like this is a pt-BR thousands number ("4.090" = 4090) while a numeric cell with the same
// raw value is a decimal (4.09), so only for these is the cell type looked up
var ambiguo = regexp.MustCompile(`^-?\d{1,3}(\.\d{3})+$`)

func lerXLSX(dados []byte, maxColunas int) iter.Seq2[Linha, error] {
	return func(yield func(Linha, error) bool) {
		f, err := excelize.OpenReader(bytes.NewReader(dados))
		if err != nil {
			yield(Linha{}, fmt.Errorf("Não foi possível ler o arquivo .xlsx: %w", err))
			return
		}
		defer f.Close()

		sheet := f.GetSheetName(0)
		rows, err := f.Rows(sheet)
		if err != nil {
			yield(Linha{}, fmt.Errorf("Não foi possível ler a planilha %q: %w", sheet, err))
			return
		}
		defer rows.Close()

		for numero := 1; rows.Next(); numero++ {
			// raw values: 4090.5 instead of whatever the cell's number format displays ("R$ 4.090,50")
			raw, err := rows.Columns(excelize.Options{RawCellValue: true})
			if err != nil {
				yield(Linha{}, fmt.Errorf("Não foi possível ler a linha %d: %w", numero, err))
				return
			}
			celulas := make([]Celula, min(len(raw), maxColunas))
			for i := range celulas {
				celulas[i] = Celula{Texto: raw[i], Numero: ambiguo.MatchString(raw[i]) && numerica(f, sheet, i+1, numero)}
			}
			if !yield(Linha{Numero: numero, Celulas: celulas}, nil) {
				return
			}
		}
		if err := rows.Error(); err != nil {
			yield(Linha{}, fmt.Errorf("Não foi possível ler o arquivo .xlsx: %w", err))
		}
	}
}

// numerica reports whether the cell holds a number. Cells without a t attribute are numbers, which
// excelize reports as CellTypeUnset.
func numerica(f *excelize.File, sheet string, coluna, linha int) bool {
	nome, err := excelize.CoordinatesToCellName(coluna, linha)
	if err != nil {
		return false
	}
	tipo, err := f.GetCellType(sheet, nome)
	return err == nil && (tipo == excelize.CellTypeNumber || tipo == excelize.CellTypeUnset)
}

func lerCSV(dados []byte, maxColunas int) iter.Seq2[Linha, error] {
	return func(yield func(Linha, error) bool) {
		dados = bytes.TrimPrefix(dados, []byte("\xef\xbb\xbf")) // Excel's UTF-8 BOM
		r := csv.NewReader(bytes.NewReader(dados))
		r.Comma = separador(dados)
		r.FieldsPerRecord = -1 // rows may have different lengths
		r.LazyQuotes = true

		for numero := 1; ; numero++ {
			campos, err := r.Read()
			if errors.Is(err, io.EOF) {
				return
			}
			if err != nil {
				yield(Linha{}, fmt.Errorf("Não foi possível ler a linha %d do .csv: %w", numero, err))
				return
			}
			celulas := make([]Celula, min(len(campos), maxColunas))
			for i := range celulas {
				celulas[i] = Celula{Texto: campos[i]}
			}
			if !yield(Linha{Numero: numero, Celulas: celulas}, nil) {
				return
			}
		}
	}
}

// separador is the one that appears most often outside quotes in the first line: ';' (Excel pt-BR),
// ',' or tab, as the web's parseCsv does.
func separador(dados []byte) rune {
	primeira, _, _ := bytes.Cut(dados, []byte("\n"))
	contagem := map[rune]int{';': 0, ',': 0, '\t': 0}
	entreAspas := false
	for _, c := range string(primeira) {
		if c == '"' {
			entreAspas = !entreAspas
		} else if _, ok := contagem[c]; ok && !entreAspas {
			contagem[c]++
		}
	}
	melhor := ';'
	for _, c := range []rune{';', ',', '\t'} { // ties go to the earlier one, like the web's stable sort
		if contagem[c] > contagem[melhor] {
			melhor = c
		}
	}
	return melhor
}
