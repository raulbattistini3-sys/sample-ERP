package planilha

import (
	"math"
	"strconv"
	"strings"
)

var semSimbolos = strings.NewReplacer("R$", "", "%", "", " ", "", "\t", "", " ", "")

// NumeroValor reads a number as typed in a pt-BR or en spreadsheet: 4090 | 4090,5 | 4.090,50 | 4,090.50 |
// R$ 4.090,50 | 17,5%. Same rules as the web's parseNumberCell (web/src/features/produtos/utils/productsImport.ts).
// ok is false for an empty or non-numeric cell.
func (c Celula) NumeroValor() (valor float64, ok bool) {
	if c.Numero {
		v, err := strconv.ParseFloat(strings.TrimSpace(c.Texto), 64)
		return v, err == nil && !math.IsInf(v, 0) && !math.IsNaN(v)
	}
	raw := semSimbolos.Replace(strings.TrimSpace(c.Texto))
	if raw == "" {
		return 0, false
	}
	ultimaVirgula := strings.LastIndex(raw, ",")
	ultimoPonto := strings.LastIndex(raw, ".")
	switch {
	case ultimaVirgula > -1 && ultimoPonto > -1:
		// the later separator is the decimal one
		if ultimaVirgula > ultimoPonto {
			raw = strings.Replace(strings.ReplaceAll(raw, ".", ""), ",", ".", 1)
		} else {
			raw = strings.ReplaceAll(raw, ",", "")
		}
	case ultimaVirgula > -1:
		raw = strings.Replace(raw, ",", ".", 1)
	case ambiguo.MatchString(raw):
		raw = strings.ReplaceAll(raw, ".", "") // 4.090 = four thousand and ninety
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsInf(v, 0) || math.IsNaN(v) {
		return 0, false
	}
	return v, true
}

// Vazia is true for a blank cell; a numeric cell is never blank.
func (c Celula) Vazia() bool {
	return !c.Numero && strings.TrimSpace(c.Texto) == ""
}
