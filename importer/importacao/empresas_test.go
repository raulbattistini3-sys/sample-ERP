package importacao

import "testing"

func TestCabecalhoEmpresas(t *testing.T) {
	colunas, msg := cabecalhoEmpresas(linhaDe(1, "Nome", "Domínio", "Setor", "E-mail SAC", "País"))
	if msg != "" {
		t.Fatalf("unexpected message %q", msg)
	}
	if colunas["nome"] != 0 || colunas["dominio"] != 1 || colunas["setor"] != 2 || colunas["emailSac"] != 3 || colunas["pais"] != 4 {
		t.Fatalf("columns %v", colunas)
	}
	if _, msg := cabecalhoEmpresas(linhaDe(1, "Domínio", "Setor")); msg == "" {
		t.Fatal("a sheet without Nome must be refused")
	}
}

func TestLerEmpresa(t *testing.T) {
	colunas, _ := cabecalhoEmpresas(linhaDe(1, "Nome", "Domínio", "Setor", "Telefone", "Site", "E-mail SAC"))
	setores := map[string]string{normalizar("COMPUTER_SOFTWARE"): "COMPUTER_SOFTWARE", normalizar("Software de computador"): "COMPUTER_SOFTWARE"}

	ok := lerEmpresa(linhaDe(2, " Acme  Ltda ", "https://www.Acme.com.br/contato", "software de computador", "+55 11 4000-0000", "acme.com.br", "SAC@Acme.com.br"), colunas, setores)
	if ok.erro != nil {
		t.Fatalf("unexpected error %+v", ok.erro)
	}
	if ok.nome != "Acme Ltda" || ok.dominio != "acme.com.br" || ok.setor != "COMPUTER_SOFTWARE" || ok.emailSac != "sac@acme.com.br" {
		t.Fatalf("read %+v", ok)
	}

	casos := []struct {
		linha []string
		campo string
	}{
		{[]string{"", "acme.com"}, "nome"},
		{[]string{"Acme", "acme"}, "dominio"},
		{[]string{"Acme", "", "Padaria espacial"}, "setor"},
		{[]string{"Acme", "", "", "abc"}, "telefone"},
		{[]string{"Acme", "", "", "", "sem ponto"}, "site"},
		{[]string{"Acme", "", "", "", "", "sac@"}, "emailSac"},
	}
	for _, c := range casos {
		e := lerEmpresa(linhaDe(3, c.linha...), colunas, setores)
		if e.erro == nil || e.erro.Campo != c.campo {
			t.Errorf("%v: want an error on %s, got %+v", c.linha, c.campo, e.erro)
		}
	}
}
