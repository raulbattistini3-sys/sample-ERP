package importacao

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"regexp"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/raulbattistini3-sys/sample-ERP/importer/hubspot"
	"github.com/raulbattistini3-sys/sample-ERP/importer/planilha"
	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

// colunas read from a clients spreadsheet; the rest of a wide sheet is ignored
const colunasClientes = 40

// ProcessadorClientes imports a clients spreadsheet into HubSpot (contacts are never copied into the
// database: only the ERP's own field, senioridade, is written there).
//
// Unlike products it is not all-or-nothing, and it never holds the rows in memory: the file is read twice
// as a stream, first to count (and refuse more than maxLinhas), then in batches of 100. Each batch goes to
// HubSpot and then commits its checkpoint, counters and errors in one transaction, so the web can show
// progress and errors as they happen, and an import interrupted (deploy, crash, lost claim) resumes after
// the last committed batch instead of starting over. What stays in memory is the set of e-mails already
// seen (to catch repeats) and the company names already resolved.
//
// The batches go to HubSpot from `workers` goroutines at once (see pipeline): one goroutine reads the
// sheet and hands out batches, the workers send them, and their results come back over a channel to one
// goroutine that sums them up and commits them in order.
type ProcessadorClientes struct {
	pool      *pgxpool.Pool
	repo      *postgres.Importacoes
	hs        *hubspot.Client
	maxLinhas int
	workers   int
}

// NewProcessadorClientes returns a ProcessadorClientes that refuses spreadsheets with more than maxLinhas
// rows and sends up to `workers` batches to HubSpot at the same time.
func NewProcessadorClientes(pool *pgxpool.Pool, repo *postgres.Importacoes, hs *hubspot.Client, maxLinhas, workers int) *ProcessadorClientes {
	return &ProcessadorClientes{pool: pool, repo: repo, hs: hs, maxLinhas: maxLinhas, workers: workers}
}

type clienteLinha struct {
	linha                                                                 int32
	primeiroNome, sobrenome, email, telefone, empresa, cargo, senioridade string
	decisor                                                               *bool
	erro                                                                  *postgres.ErroCliente
	contatoID                                                             string // once saved in HubSpot
}

// Processar takes a claimed clients import to its final status. A returned error leaves it processando
// (database trouble, shutdown, lost claim) and it resumes from its checkpoint when claimed again.
func (p *ProcessadorClientes) Processar(ctx context.Context, job *postgres.Job) error {
	falhar := func(status postgres.Status, mensagem string) error {
		return p.repo.Finalizar(ctx, p.pool, job, postgres.Resultado{Status: status, TotalLinhas: job.TotalLinhas, Mensagem: mensagem})
	}

	// 1st pass: the header and the row count, before anything reaches HubSpot
	var colunas map[string]int
	total := 0
	for linha, err := range planilha.Ler(job.NomeArquivo, job.Planilha, colunasClientes) {
		if err != nil {
			return falhar(postgres.StatusFalhou, mensagemDeLeitura(err))
		}
		if colunas == nil {
			var msg string
			if colunas, msg = cabecalhoClientes(linha); msg != "" {
				return falhar(postgres.StatusFalhou, msg)
			}
			continue
		}
		if !vazia(linha) {
			total++
		}
	}
	switch {
	case colunas == nil || total == 0:
		return falhar(postgres.StatusFalhou, "A planilha não tem nenhum cliente.")
	case total > p.maxLinhas:
		return p.repo.Finalizar(ctx, p.pool, job, postgres.Resultado{
			Status: postgres.StatusRejeitada, TotalLinhas: int32(total),
			Mensagem: fmt.Sprintf("A planilha tem %d clientes; o máximo por importação é %d. Divida em partes.", total, p.maxLinhas),
		})
	}
	if err := p.repo.Comecar(ctx, job, int32(total)); err != nil {
		return err
	}

	// 2nd pass, in batches sent by the workers
	empresas := novasEmpresasResolvidas() // lowercase name -> HubSpot id, shared by the workers
	envios := iniciarPipeline(ctx, p.workers,
		func(ctx context.Context, lote []clienteLinha, processadas int32) (envio, error) {
			return p.enviarLote(ctx, job, lote, processadas, empresas)
		},
		func(ctx context.Context, e envio) error { return commitLote(ctx, p.pool, p.repo, job, e) },
	)
	soma, fatal, err := p.segundaPassada(job, colunas, envios)
	if errLeitura, ok := err.(erroDeLeitura); ok {
		return falhar(postgres.StatusFalhou, errLeitura.mensagem)
	}
	if fatal != nil {
		return p.repo.Encerrar(ctx, job, postgres.StatusFalhou, fatal.Error())
	}
	if err != nil {
		return err
	}
	p.logResumo(job, soma)

	mensagem := ""
	if imp, err := p.repo.Obter(ctx, job.ID); err == nil && imp.LinhasFalharam > 0 {
		mensagem = fmt.Sprintf("%d de %d linhas não foram importadas: veja os erros.", imp.LinhasFalharam, total)
	}
	return p.repo.Encerrar(ctx, job, postgres.StatusConcluida, mensagem)
}

// segundaPassada reads the sheet again and hands its batches to the pipeline, then waits for it.
func (p *ProcessadorClientes) segundaPassada(job *postgres.Job, colunas map[string]int, envios *pipeline[clienteLinha]) (postgres.Lote, error, error) {
	vistos := make(map[string]struct{})
	lote := make([]clienteLinha, 0, hubspot.TamanhoLote)
	indice := int32(0)
	primeira := true
	for linha, err := range planilha.Ler(job.NomeArquivo, job.Planilha, colunasClientes) {
		if err != nil {
			envios.fechar()
			return postgres.Lote{}, nil, erroDeLeitura{mensagemDeLeitura(err)}
		}
		if primeira {
			primeira = false
			continue
		}
		if vazia(linha) {
			continue
		}
		indice++
		c := lerCliente(linha, colunas)
		if indice <= job.LinhasProcessadas {
			// done by an earlier attempt: only remember its e-mail, so a repeat further down still counts as one
			if c.erro == nil {
				vistos[c.email] = struct{}{}
			}
			continue
		}
		if c.erro == nil {
			if _, repetido := vistos[c.email]; repetido {
				c.erro = &postgres.ErroCliente{Linha: c.linha, Campo: "email", Email: c.email, Mensagem: "E-mail repetido na planilha: só a primeira linha vale."}
			} else {
				vistos[c.email] = struct{}{}
			}
		}
		lote = append(lote, c)
		if len(lote) == hubspot.TamanhoLote {
			if !envios.enviar(lote, indice) {
				return envios.fechar()
			}
			lote = make([]clienteLinha, 0, hubspot.TamanhoLote) // the sent slice now belongs to a worker
		}
	}
	if len(lote) > 0 {
		envios.enviar(lote, indice)
	}
	return envios.fechar()
}

func (p *ProcessadorClientes) logResumo(job *postgres.Job, soma postgres.Lote) {
	slog.Info("clients import finished", "importacao", job.ID, "workers", p.workers,
		"criadas", soma.Criadas, "atualizadas", soma.Atualizadas, "falharam", soma.Falharam, "empresasCriadas", soma.EmpresasCriadas)
}

// enviarLote sends one batch to HubSpot and returns what to commit; it never touches the checkpoint (the
// pipeline commits in order). A fatal envio means HubSpot refused the import as a whole (not connected,
// missing scopes...); an error leaves the import to resume later.
func (p *ProcessadorClientes) enviarLote(ctx context.Context, job *postgres.Job, lote []clienteLinha, processadas int32, empresas *empresasResolvidas) (envio, error) {
	resultado := postgres.Lote{Processadas: processadas}
	falhou := func(c clienteLinha, campo, mensagem string) {
		resultado.Falharam++
		resultado.Erros = append(resultado.Erros, postgres.ErroCliente{Linha: c.linha, Campo: campo, Email: c.email, Mensagem: mensagem})
	}
	encerrar := func(err error) (envio, error) {
		if hubspot.Fatal(err) {
			return envio{fatal: err}, nil
		}
		return envio{}, err
	}

	var validos []clienteLinha
	for _, c := range lote {
		if c.erro != nil {
			resultado.Falharam++
			resultado.Erros = append(resultado.Erros, *c.erro)
		} else {
			validos = append(validos, c)
		}
	}

	// the companies, by name: found (oldest with that name) or created, once per import
	empresaDe := make(map[string]string)
	var semEmpresa []clienteLinha
	for _, c := range validos {
		if c.empresa == "" {
			semEmpresa = append(semEmpresa, c)
			continue
		}
		id, criada, err := empresas.resolver(ctx, strings.ToLower(c.empresa), func() (string, bool, error) {
			id, err := p.hs.BuscarEmpresa(ctx, c.empresa)
			if err == nil && id == "" {
				id, err = p.hs.CriarEmpresa(ctx, c.empresa)
				return id, err == nil, err
			}
			return id, false, err
		})
		if err != nil {
			if hubspot.Fatal(err) || ctx.Err() != nil {
				return encerrar(err)
			}
			falhou(c, "empresa", "Empresa: "+err.Error())
			continue
		}
		if criada {
			resultado.EmpresasCriadas++
		}
		empresaDe[c.email] = id
		semEmpresa = append(semEmpresa, c)
	}
	validos = semEmpresa

	if len(validos) > 0 {
		emails := make([]string, len(validos))
		for i, c := range validos {
			emails[i] = c.email
		}
		existentes, err := p.hs.LerContatos(ctx, emails)
		if err != nil {
			return encerrar(err)
		}

		novos := make([]hubspot.NovoContato, len(validos))
		for i, c := range validos {
			props := map[string]string{
				"firstname": c.primeiroNome, "lastname": c.sobrenome, "email": c.email, "phone": c.telefone,
				"company": c.empresa, "jobtitle": c.cargo,
			}
			if c.decisor != nil {
				props["hs_buying_role"] = papeisCom(existentes[c.email].Papeis, *c.decisor)
			}
			novos[i] = hubspot.NovoContato{Email: c.email, Propriedades: props}
		}
		salvos, err := p.hs.UpsertContatos(ctx, novos)
		if err != nil && !hubspot.Fatal(err) && ctx.Err() == nil {
			// one bad row (HubSpot rejects a whole batch over one invalid value) shouldn't fail the other 99
			salvos = make(map[string]hubspot.Contato, len(novos))
			for i, n := range novos {
				um, err := p.hs.UpsertContatos(ctx, []hubspot.NovoContato{n})
				if err != nil {
					if hubspot.Fatal(err) || ctx.Err() != nil {
						return encerrar(err)
					}
					falhou(validos[i], "", err.Error())
					continue
				}
				for k, v := range um {
					salvos[k] = v
				}
			}
		} else if err != nil {
			return encerrar(err)
		}

		var ligacoes []hubspot.Ligacao
		var ligados []clienteLinha
		var gravados []clienteLinha
		for _, c := range validos {
			contato, ok := salvos[c.email]
			if !ok {
				if !jaFalhou(resultado.Erros, c.linha) {
					falhou(c, "", "O HubSpot não devolveu este contato.")
				}
				continue
			}
			c.contatoID = contato.ID
			gravados = append(gravados, c)
			if _, existia := existentes[c.email]; existia {
				resultado.Atualizadas++
			} else {
				resultado.Criadas++
			}
			if id, ok := empresaDe[c.email]; ok {
				ligacoes = append(ligacoes, hubspot.Ligacao{ContatoID: contato.ID, EmpresaID: id})
				ligados = append(ligados, c)
			}
		}
		if len(ligacoes) > 0 {
			if err := p.hs.Ligar(ctx, ligacoes); err != nil {
				if hubspot.Fatal(err) || ctx.Err() != nil {
					return encerrar(err)
				}
				for _, c := range ligados {
					resultado.Erros = append(resultado.Erros, postgres.ErroCliente{
						Linha: c.linha, Campo: "empresa", Email: c.email, Mensagem: "Salvo, mas não foi ligado à empresa: " + err.Error(),
					})
				}
			}
		}

		var ids, valores []string
		for _, c := range gravados {
			if c.senioridade != "" {
				ids = append(ids, c.contatoID)
				valores = append(valores, c.senioridade)
			}
		}
		e := envio{resultado: resultado}
		if len(ids) > 0 {
			e.gravar = func(ctx context.Context, tx pgx.Tx) error {
				_, err := tx.Exec(ctx, `
					INSERT INTO cliente_senioridades (hubspot_contato_id, senioridade, atualizado_por)
					SELECT id, senioridade, $3 FROM unnest($1::text[], $2::text[]) AS s(id, senioridade)
					ON CONFLICT (hubspot_contato_id) DO UPDATE
					SET senioridade = excluded.senioridade, atualizado_por = excluded.atualizado_por, atualizado_em = now()`,
					ids, valores, job.UsuarioID)
				return err
			}
		}
		return e, nil
	}

	return envio{resultado: resultado}, nil
}

// commitLote writes one batch's own rows, its errors and the checkpoint in one transaction.
func commitLote(ctx context.Context, pool *pgxpool.Pool, repo *postgres.Importacoes, job *postgres.Job, e envio) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if e.gravar != nil {
			if err := e.gravar(ctx, tx); err != nil {
				return err
			}
		}
		return repo.Avancar(ctx, tx, job, e.resultado)
	})
}

// erroDeLeitura is a spreadsheet that stopped being readable halfway: the import fails with this message.
type erroDeLeitura struct{ mensagem string }

func (e erroDeLeitura) Error() string { return e.mensagem }

func jaFalhou(erros []postgres.ErroCliente, linha int32) bool {
	for _, e := range erros {
		if e.Linha == linha {
			return true
		}
	}
	return false
}

// papeisCom adds or removes DECISION_MAKER from a contact's buying roles, keeping the others
// (hubspot.service.ts papeisCom).
func papeisCom(atuais string, decisor bool) string {
	papeis := []string{}
	if decisor {
		papeis = append(papeis, "DECISION_MAKER")
	}
	for _, p := range strings.Split(atuais, ";") {
		if p = strings.TrimSpace(p); p != "" && p != "DECISION_MAKER" {
			papeis = append(papeis, p)
		}
	}
	return strings.Join(papeis, ";")
}

// --- reading a row (mirrors api/src/services/cliente.service.ts ClienteSchema) ---

var camposCabecalho = map[string]string{
	"nome": "primeiroNome", "primeironome": "primeiroNome", "firstname": "primeiroNome",
	"sobrenome": "sobrenome", "lastname": "sobrenome",
	"email":    "email",
	"telefone": "telefone", "phone": "telefone", "celular": "telefone",
	"empresa": "empresa", "company": "empresa",
	"cargo": "cargo", "jobtitle": "cargo",
	"senioridade": "senioridade", "seniority": "senioridade",
	"decisor": "decisor", "stakeholder": "decisor",
}

var senioridades = map[string]string{}

func init() {
	pares := [][2]string{
		{"owner", "Proprietário"}, {"partner", "Sócio"}, {"executive", "Executivo"}, {"vp", "Vice-presidente"},
		{"director", "Diretor"}, {"manager", "Gerente"}, {"senior", "Sênior"}, {"employee", "Funcionário"}, {"entry", "Júnior"},
	}
	for _, p := range pares {
		senioridades[normalizar(p[0])] = p[0]
		senioridades[normalizar(p[1])] = p[0]
	}
}

var (
	sim        = map[string]bool{"sim": true, "s": true, "x": true, "true": true, "verdadeiro": true, "1": true, "yes": true, "y": true}
	nao        = map[string]bool{"nao": true, "n": true, "false": true, "falso": true, "0": true, "no": true}
	telefoneOK = regexp.MustCompile(`^[+\d\s().-]{8,40}$`)
	semAcentos = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
)

// normalizar: no accents, lowercase, only a-z and digits ("E-mail" -> "email", "Júnior" -> "junior")
func normalizar(s string) string {
	t, _, _ := transform.String(semAcentos, s)
	var b strings.Builder
	for _, r := range strings.ToLower(t) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func cabecalhoClientes(l planilha.Linha) (map[string]int, string) {
	colunas := make(map[string]int)
	for i, c := range l.Celulas {
		if campo, ok := camposCabecalho[normalizar(c.Texto)]; ok {
			if _, ja := colunas[campo]; !ja {
				colunas[campo] = i
			}
		}
	}
	if _, ok := colunas["email"]; !ok {
		return nil, `A planilha precisa de uma coluna "E-mail" na primeira linha.`
	}
	if _, ok := colunas["primeiroNome"]; !ok {
		return nil, `A planilha precisa de uma coluna "Nome" na primeira linha.`
	}
	return colunas, ""
}

func vazia(l planilha.Linha) bool {
	for _, c := range l.Celulas {
		if strings.TrimSpace(c.Texto) != "" {
			return false
		}
	}
	return true
}

func lerCliente(l planilha.Linha, colunas map[string]int) clienteLinha {
	valor := func(campo string) string {
		i, ok := colunas[campo]
		if !ok || i >= len(l.Celulas) {
			return ""
		}
		return strings.Join(strings.Fields(l.Celulas[i].Texto), " ")
	}
	c := clienteLinha{
		linha: int32(l.Numero), primeiroNome: valor("primeiroNome"), sobrenome: valor("sobrenome"),
		email: strings.ToLower(valor("email")), telefone: valor("telefone"), empresa: valor("empresa"), cargo: valor("cargo"),
	}
	erro := func(campo, mensagem string) clienteLinha {
		c.erro = &postgres.ErroCliente{Linha: c.linha, Campo: campo, Email: c.email, Mensagem: mensagem}
		return c
	}
	n := func(s string) int { return len([]rune(s)) }

	switch {
	case c.primeiroNome == "":
		return erro("primeiroNome", "Informe o nome.")
	case n(c.primeiroNome) > 100:
		return erro("primeiroNome", "O nome aceita até 100 caracteres.")
	case n(c.sobrenome) > 100:
		return erro("sobrenome", "O sobrenome aceita até 100 caracteres.")
	case c.email == "":
		return erro("email", "Informe o e-mail: é por ele que o cliente é encontrado de novo.")
	case n(c.email) > 254 || !emailValido(c.email):
		return erro("email", "E-mail inválido.")
	case c.telefone != "" && !telefoneOK.MatchString(c.telefone):
		return erro("telefone", "Telefone inválido.")
	case n(c.empresa) > 150:
		return erro("empresa", "O nome da empresa aceita até 150 caracteres.")
	case n(c.cargo) > 150:
		return erro("cargo", "O cargo aceita até 150 caracteres.")
	}
	if s := valor("senioridade"); s != "" {
		v, ok := senioridades[normalizar(s)]
		if !ok {
			return erro("senioridade", "Senioridade inválida.")
		}
		c.senioridade = v
	}
	if d := valor("decisor"); d != "" {
		k := normalizar(d)
		switch {
		case sim[k]:
			v := true
			c.decisor = &v
		case nao[k]:
			v := false
			c.decisor = &v
		default:
			return erro("decisor", fmt.Sprintf(`Decisor "%s": use Sim ou Não.`, d))
		}
	}
	return c
}

func emailValido(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && strings.Contains(s[strings.LastIndex(s, "@"):], ".")
}

func mensagemDeLeitura(err error) string {
	if errors.Is(err, planilha.ErrFormato) {
		return planilha.ErrFormato.Error()
	}
	return "Não foi possível ler a planilha. Confira se o arquivo é um .xlsx ou .csv válido."
}
