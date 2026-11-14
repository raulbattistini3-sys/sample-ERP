package importacao

import (
	"testing"

	"github.com/raulbattistini3-sys/sample-ERP/importer/planilha"
)

func linhaDe(numero int, textos ...string) planilha.Linha {
	l := planilha.Linha{Numero: numero}
	for _, t := range textos {
		l.Celulas = append(l.Celulas, planilha.Celula{Texto: t})
	}
	return l
}

func TestCabecalhoClientes(t *testing.T) {
	colunas, msg := cabecalhoClientes(linhaDe(1, "E-mail", "Primeiro nome", "Júnior?", "Senioridade", "Decisor"))
	if msg != "" || colunas["email"] != 0 || colunas["primeiroNome"] != 1 || colunas["senioridade"] != 3 || colunas["decisor"] != 4 {
		t.Fatalf("cabecalho = %v, %q", colunas, msg)
	}
	if _, msg := cabecalhoClientes(linhaDe(1, "Nome")); msg == "" {
		t.Error("header without e-mail accepted")
	}
}

func TestLerCliente(t *testing.T) {
	colunas, _ := cabecalhoClientes(linhaDe(1, "Nome", "Sobrenome", "E-mail", "Telefone", "Empresa", "Cargo", "Senioridade", "Decisor"))
	casos := []struct {
		nome  string
		linha planilha.Linha
		campo string // "" = valid
	}{
		{"valido", linhaDe(2, "Ana", "Silva", " ANA@Exemplo.com ", "+55 11 99999-0000", "Acme", "CTO", "Diretor", "Sim"), ""},
		{"sem nome", linhaDe(3, "", "", "a@b.co"), "primeiroNome"},
		{"email ruim", linhaDe(4, "Ana", "", "ana@"), "email"},
		{"telefone ruim", linhaDe(5, "Ana", "", "a@b.co", "abc"), "telefone"},
		{"senioridade", linhaDe(6, "Ana", "", "a@b.co", "", "", "", "Chefe"), "senioridade"},
		{"decisor", linhaDe(7, "Ana", "", "a@b.co", "", "", "", "", "talvez"), "decisor"},
		{"label sem acento", linhaDe(8, "Ana", "", "a@b.co", "", "", "", "junior", "não"), ""},
	}
	for _, c := range casos {
		got := lerCliente(c.linha, colunas)
		switch {
		case c.campo == "" && got.erro != nil:
			t.Errorf("%s: unexpected error %+v", c.nome, *got.erro)
		case c.campo != "" && (got.erro == nil || got.erro.Campo != c.campo):
			t.Errorf("%s: erro = %+v, want campo %s", c.nome, got.erro, c.campo)
		}
	}
	v := lerCliente(casos[0].linha, colunas)
	if v.email != "ana@exemplo.com" || v.senioridade != "director" || v.decisor == nil || !*v.decisor {
		t.Errorf("valido = %+v", v)
	}
	if j := lerCliente(casos[6].linha, colunas); j.senioridade != "entry" || j.decisor == nil || *j.decisor {
		t.Errorf("junior/nao = %+v", j)
	}
}

func TestPapeisCom(t *testing.T) {
	if got := papeisCom("INFLUENCER;DECISION_MAKER", false); got != "INFLUENCER" {
		t.Errorf("remove = %q", got)
	}
	if got := papeisCom("INFLUENCER", true); got != "DECISION_MAKER;INFLUENCER" {
		t.Errorf("add = %q", got)
	}
}
