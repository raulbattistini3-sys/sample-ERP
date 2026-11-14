package importacao

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/raulbattistini3-sys/sample-ERP/importer/hubspot"
	"github.com/raulbattistini3-sys/sample-ERP/importer/planilha"
	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

const colunasEmpresas = 30

// ProcessadorEmpresas imports a companies spreadsheet into HubSpot, the same way ProcessadorClientes does
// clients: two streaming passes (count, then batches of 100), each batch committed with its checkpoint, so
// an interrupted import resumes after the last batch. A company is found by name (the oldest with it, as
// "Criar empresa" and the clients import do) and updated, or created when there's none; empty cells
// never blank what HubSpot has. The SAC e-mail is the ERP's own field (empresa_contatos_erp).
type ProcessadorEmpresas struct {
	pool      *pgxpool.Pool
	repo      *postgres.Importacoes
	hs        *hubspot.Client
	maxLinhas int
	workers   int
}

// NewProcessadorEmpresas returns a ProcessadorEmpresas that refuses spreadsheets with more than maxLinhas
// rows and sends up to `workers` batches to HubSpot at the same time (see pipeline).
func NewProcessadorEmpresas(pool *pgxpool.Pool, repo *postgres.Importacoes, hs *hubspot.Client, maxLinhas, workers int) *ProcessadorEmpresas {
	return &ProcessadorEmpresas{pool: pool, repo: repo, hs: hs, maxLinhas: maxLinhas, workers: workers}
}

type empresaLinha struct {
	linha                                                                 int32
	nome, dominio, setor, telefone, site, cidade, estado, pais, descricao string
	emailSac                                                              string
	erro                                                                  *postgres.ErroCliente
}

func (e empresaLinha) chave() string { return strings.ToLower(e.nome) }

func (e empresaLinha) propriedades() map[string]string {
	return map[string]string{
		"name": e.nome, "domain": e.dominio, "industry": e.setor, "phone": e.telefone, "website": e.site,
		"city": e.cidade, "state": e.estado, "country": e.pais, "description": e.descricao,
	}
}

// Processar takes a claimed companies import to its final status. A returned error leaves it processando
// and it resumes from its checkpoint when claimed again.
func (p *ProcessadorEmpresas) Processar(ctx context.Context, job *postgres.Job) error {
	falhar := func(status postgres.Status, mensagem string) error {
		return p.repo.Finalizar(ctx, p.pool, job, postgres.Resultado{Status: status, TotalLinhas: job.TotalLinhas, Mensagem: mensagem})
	}

	var colunas map[string]int
	total := 0
	for linha, err := range planilha.Ler(job.NomeArquivo, job.Planilha, colunasEmpresas) {
		if err != nil {
			return falhar(postgres.StatusFalhou, mensagemDeLeitura(err))
		}
		if colunas == nil {
			var msg string
			if colunas, msg = cabecalhoEmpresas(linha); msg != "" {
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
		return falhar(postgres.StatusFalhou, "A planilha não tem nenhuma empresa.")
	case total > p.maxLinhas:
		return p.repo.Finalizar(ctx, p.pool, job, postgres.Resultado{
			Status: postgres.StatusRejeitada, TotalLinhas: int32(total),
			Mensagem: fmt.Sprintf("A planilha tem %d empresas; o máximo por importação é %d. Divida em partes.", total, p.maxLinhas),
		})
	}

	// HubSpot's industries, read once: a row may give the value (COMPUTER_SOFTWARE) or its label
	var setores map[string]string
	if _, ok := colunas["setor"]; ok {
		lidos, err := p.hs.Setores(ctx)
		if err != nil {
			if hubspot.Fatal(err) {
				return p.repo.Finalizar(ctx, p.pool, job, postgres.Resultado{Status: postgres.StatusFalhou, TotalLinhas: int32(total), Mensagem: err.Error()})
			}
			return err
		}
		setores = make(map[string]string, 2*len(lidos))
		for _, s := range lidos {
			setores[normalizar(s.Valor)] = s.Valor
			setores[normalizar(s.Rotulo)] = s.Valor
		}
	}

	if err := p.repo.Comecar(ctx, job, int32(total)); err != nil {
		return err
	}

	// a repeated name is caught here, before the batches split up, so two workers never create the same company
	envios := iniciarPipeline(ctx, p.workers,
		func(ctx context.Context, lote []empresaLinha, processadas int32) (envio, error) {
			return p.enviarLote(ctx, job, lote, processadas)
		},
		func(ctx context.Context, e envio) error { return commitLote(ctx, p.pool, p.repo, job, e) },
	)
	soma, fatal, err := p.segundaPassada(job, colunas, setores, envios)
	if errLeitura, ok := err.(erroDeLeitura); ok {
		return falhar(postgres.StatusFalhou, errLeitura.mensagem)
	}
	if fatal != nil {
		return p.repo.Encerrar(ctx, job, postgres.StatusFalhou, fatal.Error())
	}
	if err != nil {
		return err
	}
	slog.Info("companies import finished", "importacao", job.ID, "workers", p.workers,
		"criadas", soma.Criadas, "atualizadas", soma.Atualizadas, "falharam", soma.Falharam)

	mensagem := ""
	if imp, err := p.repo.Obter(ctx, job.ID); err == nil && imp.LinhasFalharam > 0 {
		mensagem = fmt.Sprintf("%d de %d linhas não foram importadas: veja os erros.", imp.LinhasFalharam, total)
	}
	return p.repo.Encerrar(ctx, job, postgres.StatusConcluida, mensagem)
}

// segundaPassada reads the sheet again and hands its batches to the pipeline, then waits for it.
func (p *ProcessadorEmpresas) segundaPassada(job *postgres.Job, colunas map[string]int, setores map[string]string, envios *pipeline[empresaLinha]) (postgres.Lote, error, error) {
	vistos := make(map[string]struct{})
	lote := make([]empresaLinha, 0, hubspot.TamanhoLote)
	indice := int32(0)
	primeira := true
	for linha, err := range planilha.Ler(job.NomeArquivo, job.Planilha, colunasEmpresas) {
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
		e := lerEmpresa(linha, colunas, setores)
		if indice <= job.LinhasProcessadas {
			if e.erro == nil {
				vistos[e.chave()] = struct{}{}
			}
			continue
		}
		if e.erro == nil {
			if _, repetida := vistos[e.chave()]; repetida {
				e.erro = &postgres.ErroCliente{Linha: e.linha, Campo: "nome", Email: e.nome, Mensagem: "Empresa repetida na planilha: só a primeira linha vale."}
			} else {
				vistos[e.chave()] = struct{}{}
			}
		}
		lote = append(lote, e)
		if len(lote) == hubspot.TamanhoLote {
			if !envios.enviar(lote, indice) {
				return envios.fechar()
			}
			lote = make([]empresaLinha, 0, hubspot.TamanhoLote) // the sent slice now belongs to a worker
		}
	}
	if len(lote) > 0 {
		envios.enviar(lote, indice)
	}
	return envios.fechar()
}

// enviarLote finds, updates or creates one batch of companies and returns what to commit (the counters,
// errors and SAC e-mails); the pipeline commits it in order with the checkpoint.
func (p *ProcessadorEmpresas) enviarLote(ctx context.Context, job *postgres.Job, lote []empresaLinha, processadas int32) (envio, error) {
	resultado := postgres.Lote{Processadas: processadas}
	falhou := func(e empresaLinha, campo, mensagem string) {
		resultado.Falharam++
		resultado.Erros = append(resultado.Erros, postgres.ErroCliente{Linha: e.linha, Campo: campo, Email: e.nome, Mensagem: mensagem})
	}
	encerrar := func(err error) (envio, error) {
		if hubspot.Fatal(err) {
			return envio{fatal: err}, nil
		}
		return envio{}, err
	}
	interromper := func(err error) bool { return hubspot.Fatal(err) || ctx.Err() != nil }

	var validas []empresaLinha
	for _, e := range lote {
		if e.erro != nil {
			resultado.Falharam++
			resultado.Erros = append(resultado.Erros, *e.erro)
		} else {
			validas = append(validas, e)
		}
	}

	salvas := make(map[string]string) // lowercase name -> id, of the rows HubSpot took
	if len(validas) > 0 {
		nomes := make([]string, len(validas))
		for i, e := range validas {
			nomes[i] = e.nome
		}
		existentes, err := p.hs.BuscarEmpresas(ctx, nomes)
		if err != nil {
			return encerrar(err)
		}

		var novas, antigas []empresaLinha
		for _, e := range validas {
			if _, ok := existentes[e.chave()]; ok {
				antigas = append(antigas, e)
			} else {
				novas = append(novas, e)
			}
		}

		// updates: the name stays as HubSpot has it (it was found ignoring case)
		if len(antigas) > 0 {
			atualizar := func(grupo []empresaLinha) (map[string]bool, error) {
				entradas := make([]hubspot.Empresa, len(grupo))
				for i, e := range grupo {
					props := e.propriedades()
					delete(props, "name")
					entradas[i] = hubspot.Empresa{ID: existentes[e.chave()], Propriedades: props}
				}
				return p.hs.AtualizarEmpresas(ctx, entradas)
			}
			feitas, err := atualizar(antigas)
			if err != nil && !interromper(err) {
				// HubSpot rejects a whole batch over one invalid value: one by one, so the others still go in
				feitas = make(map[string]bool, len(antigas))
				for _, e := range antigas {
					um, err := atualizar([]empresaLinha{e})
					if err != nil {
						if interromper(err) {
							return encerrar(err)
						}
						falhou(e, "", err.Error())
						continue
					}
					for id := range um {
						feitas[id] = true
					}
				}
			} else if err != nil {
				return encerrar(err)
			}
			for _, e := range antigas {
				id := existentes[e.chave()]
				switch {
				case feitas[id]:
					resultado.Atualizadas++
					salvas[e.chave()] = id
				case !jaFalhou(resultado.Erros, e.linha):
					falhou(e, "", "O HubSpot não devolveu esta empresa.")
				}
			}
		}

		if len(novas) > 0 {
			criar := func(grupo []empresaLinha) (map[string]string, error) {
				entradas := make([]hubspot.Empresa, len(grupo))
				for i, e := range grupo {
					entradas[i] = hubspot.Empresa{Propriedades: e.propriedades()}
				}
				return p.hs.CriarEmpresas(ctx, entradas)
			}
			criadas, err := criar(novas)
			if err != nil && !interromper(err) {
				criadas = make(map[string]string, len(novas))
				for _, e := range novas {
					um, err := criar([]empresaLinha{e})
					if err != nil {
						if interromper(err) {
							return encerrar(err)
						}
						falhou(e, "", err.Error())
						continue
					}
					for k, v := range um {
						criadas[k] = v
					}
				}
			} else if err != nil {
				return encerrar(err)
			}
			for _, e := range novas {
				id, ok := criadas[e.chave()]
				switch {
				case ok:
					resultado.Criadas++
					salvas[e.chave()] = id
				case !jaFalhou(resultado.Erros, e.linha):
					falhou(e, "", "O HubSpot não devolveu esta empresa.")
				}
			}
		}
	}

	var ids, emails []string
	for _, e := range validas {
		if id, ok := salvas[e.chave()]; ok && e.emailSac != "" {
			ids = append(ids, id)
			emails = append(emails, e.emailSac)
		}
	}
	e := envio{resultado: resultado}
	if len(ids) > 0 {
		e.gravar = func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `
				INSERT INTO empresa_contatos_erp (hubspot_empresa_id, email_sac, atualizado_por)
				SELECT id, email, $3 FROM unnest($1::text[], $2::text[]) AS s(id, email)
				ON CONFLICT (hubspot_empresa_id) DO UPDATE
				SET email_sac = excluded.email_sac, atualizado_por = excluded.atualizado_por, atualizado_em = now()`,
				ids, emails, job.UsuarioID)
			return err
		}
	}
	return e, nil
}

// --- reading a row (mirrors api/src/services/empresa.service.ts EmpresaSchema) ---

var camposEmpresa = map[string]string{
	"nome": "nome", "empresa": "nome", "name": "nome", "razaosocial": "nome", "nomedaempresa": "nome",
	"dominio": "dominio", "domain": "dominio",
	"setor": "setor", "industry": "setor", "segmento": "setor",
	"telefone": "telefone", "phone": "telefone",
	"site": "site", "website": "site",
	"cidade": "cidade", "city": "cidade",
	"estado": "estado", "uf": "estado", "state": "estado",
	"pais": "pais", "country": "pais",
	"descricao": "descricao", "description": "descricao",
	"emailsac": "emailSac", "sac": "emailSac", "emaildesac": "emailSac", "emaildosac": "emailSac",
}

var (
	dominioOK = regexp.MustCompile(`^[a-z0-9-]+(\.[a-z0-9-]+)+$`)
	siteOK    = regexp.MustCompile(`(?i)^(https?://)?[^\s.]+\.[^\s]+$`)
	esquema   = regexp.MustCompile(`^https?://`)
)

func cabecalhoEmpresas(l planilha.Linha) (map[string]int, string) {
	colunas := make(map[string]int)
	for i, c := range l.Celulas {
		if campo, ok := camposEmpresa[normalizar(c.Texto)]; ok {
			if _, ja := colunas[campo]; !ja {
				colunas[campo] = i
			}
		}
	}
	if _, ok := colunas["nome"]; !ok {
		return nil, `A planilha precisa de uma coluna "Nome" na primeira linha.`
	}
	return colunas, ""
}

// normalizarDominio: "https://www.acme.com.br/x" -> "acme.com.br"
func normalizarDominio(s string) string {
	s = esquema.ReplaceAllString(strings.ToLower(s), "")
	s = strings.TrimPrefix(s, "www.")
	if i := strings.Index(s, "/"); i >= 0 {
		s = s[:i]
	}
	return s
}

func lerEmpresa(l planilha.Linha, colunas map[string]int, setores map[string]string) empresaLinha {
	valor := func(campo string) string {
		i, ok := colunas[campo]
		if !ok || i >= len(l.Celulas) {
			return ""
		}
		return strings.Join(strings.Fields(l.Celulas[i].Texto), " ")
	}
	e := empresaLinha{
		linha: int32(l.Numero), nome: valor("nome"), dominio: normalizarDominio(valor("dominio")), telefone: valor("telefone"),
		site: valor("site"), cidade: valor("cidade"), estado: valor("estado"), pais: valor("pais"),
		emailSac: strings.ToLower(valor("emailSac")),
	}
	// the description keeps its line breaks
	if i, ok := colunas["descricao"]; ok && i < len(l.Celulas) {
		e.descricao = strings.TrimSpace(l.Celulas[i].Texto)
	}
	erro := func(campo, mensagem string) empresaLinha {
		e.erro = &postgres.ErroCliente{Linha: e.linha, Campo: campo, Email: e.nome, Mensagem: mensagem}
		return e
	}
	n := func(s string) int { return len([]rune(s)) }

	switch {
	case e.nome == "":
		return erro("nome", "Informe o nome da empresa.")
	case n(e.nome) > 150:
		return erro("nome", "O nome aceita até 150 caracteres.")
	case n(e.dominio) > 253 || (e.dominio != "" && !dominioOK.MatchString(e.dominio)):
		return erro("dominio", "Domínio inválido (ex.: empresa.com.br).")
	case e.telefone != "" && !telefoneOK.MatchString(e.telefone):
		return erro("telefone", "Telefone inválido.")
	case n(e.site) > 500 || (e.site != "" && !siteOK.MatchString(e.site)):
		return erro("site", "Site inválido.")
	case n(e.cidade) > 100:
		return erro("cidade", "A cidade aceita até 100 caracteres.")
	case n(e.estado) > 100:
		return erro("estado", "O estado aceita até 100 caracteres.")
	case n(e.pais) > 100:
		return erro("pais", "O país aceita até 100 caracteres.")
	case n(e.descricao) > 2000:
		return erro("descricao", "A descrição aceita até 2000 caracteres.")
	case e.emailSac != "" && (n(e.emailSac) > 254 || !emailValido(e.emailSac)):
		return erro("emailSac", "E-mail de SAC inválido.")
	}
	if s := valor("setor"); s != "" {
		v, ok := setores[normalizar(s)]
		if !ok {
			return erro("setor", fmt.Sprintf(`Setor "%s" não existe no HubSpot: use um da lista de setores.`, s))
		}
		e.setor = v
	}
	return e
}
