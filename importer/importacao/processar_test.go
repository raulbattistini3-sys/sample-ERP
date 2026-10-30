package importacao

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuri/excelize/v2"

	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// Integration tests, like importer/postgres: a throwaway database with the migrations applied, whose
// importacoes they empty; -p 1 keeps the two packages from sharing that queue at the same time.
//
//	IMPORTER_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/importer_test?sslmode=disable go test -p 1 ./importer/...

type ambiente struct {
	pool      *pgxpool.Pool
	repo      *postgres.Importacoes
	proc      *Processador
	usuarioID string
	prefixo   string // per-test SKU prefix, so runs never collide on produtos_sku_key
}

func preparar(t *testing.T) *ambiente {
	t.Helper()
	url := os.Getenv("IMPORTER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("IMPORTER_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `DELETE FROM importacoes`); err != nil {
		t.Fatal(err)
	}
	var usuarioID string
	err = pool.QueryRow(ctx, `
		INSERT INTO usuarios (nome, permissoes, email, senha, ativo)
		VALUES ('importer test', (enum_range(NULL::permissoes_usuario))[1], $1, 'x', true)
		RETURNING id`, fmt.Sprintf("importacao-test-%d@example.com", time.Now().UnixNano())).Scan(&usuarioID)
	if err != nil {
		t.Fatal(err)
	}
	repo := postgres.NewImportacoes(pool)
	return &ambiente{
		pool: pool, repo: repo, proc: NewProcessador(pool, repo, 5000), usuarioID: usuarioID,
		prefixo: fmt.Sprintf("T%d-", time.Now().UnixNano()),
	}
}

func xlsx(t *testing.T, linhas ...[]any) []byte {
	t.Helper()
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	for i, l := range linhas {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		f.SetSheetRow(sheet, cell, &l)
	}
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

var cabecalho = []any{"SKU", "Nome", "Categoria", "Valor de custo (R$)", "ICMS (%)", "Valor de venda (R$)", "Estoque"}

// processar queues the file, claims it and runs it through the Processador, like the worker does.
func (a *ambiente) processar(t *testing.T, nome string, dados []byte) postgres.Importacao {
	t.Helper()
	ctx := context.Background()
	if _, err := a.repo.Criar(ctx, a.usuarioID, nome, dados); err != nil {
		t.Fatal(err)
	}
	job, err := a.repo.Reivindicar(ctx)
	if err != nil || job == nil {
		t.Fatalf("Reivindicar = %v, %v", job, err)
	}
	if err := a.proc.Processar(ctx, job); err != nil {
		t.Fatalf("Processar: %v", err)
	}
	imp, err := a.repo.Obter(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	return imp
}

func (a *ambiente) produto(t *testing.T, sku, categoria string, venda float64, ativo bool) string {
	t.Helper()
	var id string
	err := a.pool.QueryRow(context.Background(), `
		INSERT INTO produtos (name, ativo, sku, categoria_id, valor_de_custo, icms, valor_de_venda, data_de_cadastro, quantidade_em_estoque)
		VALUES ('Antigo', $1, $2, (SELECT id FROM categorias WHERE nome = $3), 45.90, 18, $4, now(), 25)
		RETURNING id`, ativo, a.prefixo+sku, categoria, venda).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestProcessarCriaEAtualiza(t *testing.T) {
	a := preparar(t)
	ctx := context.Background()

	// a connected, configured Jira, so changed products get an envio
	tag, err := a.pool.Exec(ctx, `
		INSERT INTO integracoes (provider, access_token_cifrado, config)
		VALUES ('jira', 'x', '{"projectKey": "ERP", "issueTypeId": "1"}')
		ON CONFLICT (provider) DO NOTHING`)
	if err != nil {
		t.Fatal(err)
	}
	if tag.RowsAffected() == 1 {
		t.Cleanup(func() { a.pool.Exec(context.Background(), `DELETE FROM integracoes WHERE provider = 'jira' AND access_token_cifrado = 'x'`) })
	}

	alterado := a.produto(t, "ALTERADO", "INFORMATICA", 89.90, false) // inactive: the import reactivates it
	igual := a.produto(t, "IGUAL", "INFORMATICA", 89.90, true)
	manual := a.produto(t, "MANUAL", "INFORMATICA", 10, true)

	// a manual auditoria announcing manual's 10.00 -> 12.00, waiting for the change it describes
	var manualAuditoria string
	err = a.pool.QueryRow(ctx, `
		WITH d AS (
			INSERT INTO detalhamentos_auditoria (nome_do_produto, valor_anterior, valor_atual, observacoes_adicionais)
			VALUES ('Antigo', 10, 12, 'reajuste') RETURNING id
		), au AS (
			INSERT INTO auditorias (acao_efetuada, data_de_audicao, usuario_id, detalhamento_auditoria_id)
			SELECT 'Alteracao', now(), $1, id FROM d RETURNING id
		), pa AS (
			INSERT INTO produtos_por_auditoria (auditoria_id, produto_id) SELECT id, $2 FROM au
		)
		SELECT id FROM au`, a.usuarioID, manual).Scan(&manualAuditoria)
	if err != nil {
		t.Fatal(err)
	}

	p := a.prefixo
	inicio := time.Now()
	imp := a.processar(t, "produtos.xlsx", xlsx(t,
		cabecalho,
		[]any{p + "ALTERADO", "Antigo", "informatica", "45,90", "17,5", "R$ 99,90", 25},
		[]any{p + "IGUAL", "Antigo", "INFORMATICA", 45.9, 18, 89.9, 25},
		[]any{p + "MANUAL", "Antigo", "INFORMATICA", 45.9, 18, 12, 25},
		[]any{p + "NOVO", "Mouse sem fio", "INFORMATICA", "45,90", "", "", 10},
	))
	if imp.Status != postgres.StatusConcluida || imp.TotalLinhas != 4 || imp.LinhasImportadas != 4 || len(imp.Erros) != 0 {
		t.Fatalf("importacao = %+v", imp)
	}

	// created: active, ICMS and venda defaulted to 0, registered now
	var nome string
	var ativo bool
	var icms, venda float64
	var cadastro time.Time
	err = a.pool.QueryRow(ctx, `SELECT name, ativo, icms, valor_de_venda::float8, data_de_cadastro FROM produtos WHERE sku = $1`, p+"NOVO").
		Scan(&nome, &ativo, &icms, &venda, &cadastro)
	if err != nil {
		t.Fatal(err)
	}
	if nome != "Mouse sem fio" || !ativo || icms != 0 || venda != 0 {
		t.Errorf("new product = %q ativo=%v icms=%v venda=%v", nome, ativo, icms, venda)
	}
	// timestamp without time zone holds the wall clock, like the API's new Date() through node-postgres
	wall := time.Date(inicio.Year(), inicio.Month(), inicio.Day(), inicio.Hour(), inicio.Minute(), inicio.Second(), inicio.Nanosecond(), time.UTC)
	if d := cadastro.Sub(wall); d < -time.Second || d > time.Minute {
		t.Errorf("data_de_cadastro = %v, want about %v (local wall clock)", cadastro, wall)
	}

	// updated and reactivated, with an automatic auditoria and a Jira envio
	err = a.pool.QueryRow(ctx, `SELECT ativo, icms, valor_de_venda::float8 FROM produtos WHERE id = $1`, alterado).Scan(&ativo, &icms, &venda)
	if err != nil || !ativo || icms != 17.5 || venda != 99.9 {
		t.Errorf("updated product: ativo=%v icms=%v venda=%v err=%v", ativo, icms, venda, err)
	}
	var (
		acao, observacoes, antes, depois string
		alteracoes                       []byte
		vinculada                        bool
	)
	err = a.pool.QueryRow(ctx, `
		SELECT au.acao_efetuada::text, au.vinculada_em IS NOT NULL, d.observacoes_adicionais, d.valor_anterior::text, d.valor_atual::text, d.alteracoes
		FROM auditorias au
		JOIN produtos_por_auditoria pa ON pa.auditoria_id = au.id
		JOIN detalhamentos_auditoria d ON d.id = au.detalhamento_auditoria_id
		WHERE pa.produto_id = $1`, alterado).Scan(&acao, &vinculada, &observacoes, &antes, &depois, &alteracoes)
	if err != nil {
		t.Fatalf("auditoria of the updated product: %v", err)
	}
	var campos []postgres.CampoAlterado
	json.Unmarshal(alteracoes, &campos)
	wantCampos := []postgres.CampoAlterado{
		{Campo: "ICMS", Antes: "18", Depois: "17.5"},
		{Campo: "Valor de venda", Antes: "89,90", Depois: "99,90"},
		{Campo: "Status", Antes: "Inativo", Depois: "Ativo"},
	}
	if acao != "Alteracao" || !vinculada || antes != "89.90" || depois != "99.90" || fmt.Sprint(campos) != fmt.Sprint(wantCampos) {
		t.Errorf("auditoria = %s vinculada=%v %s -> %s %+v", acao, vinculada, antes, depois, campos)
	}
	if want := "Alteração registrada automaticamente. ICMS: 18 → 17.5; Valor de venda: 89,90 → 99,90; Status: Inativo → Ativo"; observacoes != want {
		t.Errorf("observacoes = %q\nwant         %q", observacoes, want)
	}
	var envio struct {
		provider, categoria string
		semJob              bool
	}
	err = a.pool.QueryRow(ctx, `
		SELECT e.provider::text, e.categoria_nome, e.job_id IS NULL
		FROM auditoria_integracao_envios e
		JOIN produtos_por_auditoria pa ON pa.auditoria_id = e.auditoria_id
		WHERE pa.produto_id = $1`, alterado).Scan(&envio.provider, &envio.categoria, &envio.semJob)
	if err != nil || envio.provider != "jira" || envio.categoria != "INFORMATICA" || !envio.semJob {
		t.Errorf("envio = %+v, err = %v (want jira/INFORMATICA without a job, for the API's sweep)", envio, err)
	}

	// unchanged: no auditoria
	var n int
	a.pool.QueryRow(ctx, `SELECT count(*) FROM produtos_por_auditoria WHERE produto_id = $1`, igual).Scan(&n)
	if n != 0 {
		t.Errorf("unchanged product has %d auditorias", n)
	}

	// the manual auditoria was claimed instead of creating an automatic one
	a.pool.QueryRow(ctx, `SELECT count(*) FROM produtos_por_auditoria WHERE produto_id = $1`, manual).Scan(&n)
	a.pool.QueryRow(ctx, `SELECT vinculada_em IS NOT NULL FROM auditorias WHERE id = $1`, manualAuditoria).Scan(&vinculada)
	if n != 1 || !vinculada {
		t.Errorf("manual auditoria: product has %d auditorias, vinculada=%v; want 1, true", n, vinculada)
	}
}

func TestProcessarRejeitaSemGravar(t *testing.T) {
	a := preparar(t)
	p := a.prefixo
	imp := a.processar(t, "produtos.xlsx", xlsx(t,
		cabecalho,
		[]any{p + "OK", "Mouse", "INFORMATICA", 45.9, 18, 89.9, 25},
		[]any{p + "RUIM", "", "BRINQUEDOS", "abc", "", "", 2.5},
		[]any{p + "OK", "Mouse de novo", "INFORMATICA", 45.9, 18, 89.9, 25},
	))
	if imp.Status != postgres.StatusRejeitada || imp.TotalLinhas != 3 || imp.LinhasImportadas != 0 {
		t.Fatalf("importacao = %+v", imp)
	}
	var got []string
	for _, e := range imp.Erros {
		got = append(got, fmt.Sprintf("%d/%s: %s", e.Linha, e.Campo, e.Mensagem))
	}
	want := []string{
		"3/name: Nome vazio",
		`3/categoria: Categoria "BRINQUEDOS" não existe`,
		`3/valor_de_custo: Valor de custo não é um número ("abc")`,
		"3/quantidade_em_estoque: Estoque precisa ser um número inteiro",
		fmt.Sprintf("4/sku: SKU %sOK repetido (já está na linha 2)", p),
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("erros:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	var n int
	a.pool.QueryRow(context.Background(), `SELECT count(*) FROM produtos WHERE sku LIKE $1`, p+"%").Scan(&n)
	if n != 0 {
		t.Errorf("%d products written from a rejected spreadsheet", n)
	}
}

func TestProcessarFalha(t *testing.T) {
	a := preparar(t)
	casos := []struct {
		nome, arquivo string
		dados         []byte
		mensagem      string
	}{
		{"not a zip", "produtos.xlsx", []byte("isto não é um xlsx"), "Não foi possível ler o arquivo .xlsx"},
		{"header only", "produtos.xlsx", xlsx(t, cabecalho), "A planilha não tem nenhum produto."},
		{"csv header only", "produtos.csv", []byte("SKU;Nome\n\n"), "A planilha não tem nenhum produto."},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			imp := a.processar(t, c.arquivo, c.dados)
			if imp.Status != postgres.StatusFalhou || !strings.HasPrefix(imp.Mensagem, c.mensagem) {
				t.Errorf("importacao = %s %q, want falhou %q", imp.Status, imp.Mensagem, c.mensagem)
			}
		})
	}
}

func TestWorkerAcordaComNotificacao(t *testing.T) {
	a := preparar(t)
	ctx, cancel := context.WithCancel(context.Background())
	// an hour between polls: only the NOTIFY from Criar can get this import processed in time
	w := NewWorker(a.pool, a.repo, a.proc, WorkerConfig{Concorrencia: 2, Prazo: time.Minute, MaxTentativas: 3, Intervalo: time.Hour})
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()
	time.Sleep(500 * time.Millisecond) // let it LISTEN and drain the (empty) queue

	criada, err := a.repo.Criar(ctx, a.usuarioID, "produtos.csv", []byte(fmt.Sprintf("SKU;Nome;Categoria;Custo;ICMS;Venda;Estoque\n%sCSV;Cabo;INFORMATICA;10;;;1\n", a.prefixo)))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		imp, err := a.repo.Obter(ctx, criada.ID)
		if err != nil {
			t.Fatal(err)
		}
		if imp.Status == postgres.StatusConcluida {
			break
		}
		if imp.Status == postgres.StatusRejeitada || imp.Status == postgres.StatusFalhou || time.Now().After(deadline) {
			t.Fatalf("importacao = %+v", imp)
		}
		time.Sleep(50 * time.Millisecond)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not stop after ctx was cancelled")
	}
}
