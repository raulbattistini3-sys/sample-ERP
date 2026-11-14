package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The importacoes table is also the job queue (api/drizzle/0011_importacoes.sql):
// checkout the main api
//	Criar            -> pendente      (and NOTIFY CanalImportacoes, so idle workers wake up)
//	Reivindicar      -> processando   (FOR UPDATE SKIP LOCKED, tentativas + 1)
//	Finalizar        -> concluida | rejeitada | falhou
//	DevolverTravadas -> processando for too long goes back to pendente, or to falhou once out of tentativas
//
// tentativas doubles as a fencing token: a worker that was too slow, got its job handed back and then
// claimed by someone else, can no longer Finalizar it. Call Finalizar inside the transaction that writes
// the products, so a stale worker's ErrReivindicacaoPerdida also rolls its writes back.

// Status is where an import is. concluida, rejeitada and falhou are final.
type Status string

// match importacoes_status_check
const (
	StatusPendente    Status = "pendente"
	StatusProcessando Status = "processando"
	StatusConcluida   Status = "concluida"
	StatusRejeitada   Status = "rejeitada"
	StatusFalhou      Status = "falhou"
)

// CanalImportacoes is the LISTEN/NOTIFY channel; the payload is the importacao id.
const CanalImportacoes = "importacoes"

// Tipo is what a spreadsheet holds, and so which processor takes it (match importacoes_tipo_check).
type Tipo string

const (
	TipoProdutos Tipo = "produtos"
	TipoClientes Tipo = "clientes"
	TipoEmpresas Tipo = "empresas"
)

// Errors the repository returns for the caller to act on.
var (
	ErrNaoEncontrada        = errors.New("postgres: importacao not found")
	ErrIDInvalido           = errors.New("postgres: id is not a valid uuid")
	ErrUsuarioNaoEncontrado = errors.New("postgres: usuario not found")
	// the job's lease expired and it was handed back to the queue, so this worker's result must be dropped
	ErrReivindicacaoPerdida = errors.New("postgres: importacao is no longer claimed by this worker")
)

const (
	pgForeignKeyViolation = "23503"
	pgInvalidTextRep      = "22P02"
)

// ErroLinha is one problem in one spreadsheet row.
type ErroLinha struct {
	Linha    int32  `json:"linha"`
	Campo    string `json:"campo,omitempty"`
	Mensagem string `json:"mensagem"`
}

// Importacao is one row of the importacoes table, without the file.
type Importacao struct {
	ID                string
	UsuarioID         string
	NomeArquivo       string
	Tipo              Tipo
	Status            Status
	TotalLinhas       int32
	LinhasImportadas  int32
	LinhasCriadas     int32
	LinhasAtualizadas int32
	Erros             []ErroLinha
	Mensagem          string
	Tentativas        int32
	CriadaEm          time.Time
	IniciadaEm        *time.Time
	FinalizadaEm      *time.Time
	// clientes only: the checkpoint (rows gone through, committed after each batch) and its counters
	LinhasProcessadas int32
	LinhasFalharam    int32
	EmpresasCriadas   int32
}

// Job is a claimed importacao plus the spreadsheet to process.
type Job struct {
	Importacao
	Planilha []byte
}

// Resultado is what a worker reports when it is done with a Job.
type Resultado struct {
	Status            Status // concluida, rejeitada or falhou
	TotalLinhas       int32
	LinhasCriadas     int32
	LinhasAtualizadas int32
	Erros             []ErroLinha
	Mensagem          string
}

// DBTX is satisfied by *pgxpool.Pool, *pgx.Conn and pgx.Tx.
// keep
type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Importacoes is the job queue and the record of imports.
type Importacoes struct {
	pool *pgxpool.Pool
}

// NewImportacoes returns the repository on pool.
func NewImportacoes(pool *pgxpool.Pool) *Importacoes {
	return &Importacoes{pool: pool}
}

// planilha is left out on purpose: only Reivindicar needs the bytes
const colunas = `id, usuario_id, nome_arquivo, status, total_linhas, linhas_importadas, linhas_criadas,
	linhas_atualizadas, erros, coalesce(mensagem, ''), tentativas, criada_em, iniciada_em, finalizada_em,
	tipo, linhas_processadas, linhas_falharam, empresas_criadas`

func scanImportacao(row pgx.Row, extra ...any) (Importacao, error) {
	var i Importacao
	dest := append([]any{
		&i.ID, &i.UsuarioID, &i.NomeArquivo, &i.Status, &i.TotalLinhas, &i.LinhasImportadas, &i.LinhasCriadas,
		&i.LinhasAtualizadas, &i.Erros, &i.Mensagem, &i.Tentativas, &i.CriadaEm, &i.IniciadaEm, &i.FinalizadaEm,
		&i.Tipo, &i.LinhasProcessadas, &i.LinhasFalharam, &i.EmpresasCriadas,
	}, extra...)
	err := row.Scan(dest...)
	return i, err
}

// Criar queues an import. The NOTIFY is transactional, so it is only delivered once the row is
// committed and a woken worker always finds it.
func (r *Importacoes) Criar(ctx context.Context, tipo Tipo, usuarioID, nomeArquivo string, planilha []byte) (Importacao, error) {
	var imp Importacao
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var err error
		imp, err = scanImportacao(tx.QueryRow(ctx, `
			INSERT INTO importacoes (usuario_id, nome_arquivo, planilha, tipo)
			VALUES ($1, $2, $3, $4)
			RETURNING `+colunas, usuarioID, nomeArquivo, planilha, string(tipo)))
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT pg_notify($1, $2)`, CanalImportacoes, imp.ID)
		return err
	})
	switch pgCode(err) {
	case "":
	case pgForeignKeyViolation:
		return Importacao{}, ErrUsuarioNaoEncontrado
	case pgInvalidTextRep:
		return Importacao{}, ErrIDInvalido
	}
	if err != nil {
		return Importacao{}, fmt.Errorf("postgres: creating importacao: %w", err)
	}
	return imp, nil
}

// Obter returns an import, or ErrNaoEncontrada or ErrIDInvalido.
func (r *Importacoes) Obter(ctx context.Context, id string) (Importacao, error) {
	imp, err := scanImportacao(r.pool.QueryRow(ctx, `SELECT `+colunas+` FROM importacoes WHERE id = $1`, id))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return Importacao{}, ErrNaoEncontrada
	case pgCode(err) == pgInvalidTextRep:
		return Importacao{}, ErrIDInvalido
	case err != nil:
		return Importacao{}, fmt.Errorf("postgres: reading importacao %s: %w", id, err)
	}
	return imp, nil
}

// Reivindicar claims the oldest pendente import for this worker, or returns nil when the queue is empty.
// SKIP LOCKED lets concurrent workers claim different jobs without waiting for each other.
func (r *Importacoes) Reivindicar(ctx context.Context) (*Job, error) {
	var planilha []byte
	imp, err := scanImportacao(r.pool.QueryRow(ctx, `
		UPDATE importacoes
		SET status = 'processando', iniciada_em = now(), tentativas = tentativas + 1
		WHERE id = (
			SELECT id FROM importacoes
			WHERE status = 'pendente'
			ORDER BY criada_em
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING `+colunas+`, planilha`), &planilha)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: claiming importacao: %w", err)
	}
	return &Job{Importacao: imp, Planilha: planilha}, nil
}

// Finalizar records a final status on db, and returns ErrReivindicacaoPerdida when the job's claim is gone.
// It also drops the stored file.
func (r *Importacoes) Finalizar(ctx context.Context, db DBTX, job *Job, res Resultado) error {
	switch res.Status {
	case StatusConcluida, StatusRejeitada, StatusFalhou:
	default:
		return fmt.Errorf("postgres: %q is not a final status", res.Status)
	}
	erros := res.Erros
	if erros == nil {
		erros = []ErroLinha{} // '[]', not JSON null
	}

	tag, err := db.Exec(ctx, `
		UPDATE importacoes
		SET status = $3, total_linhas = $4, linhas_criadas = $5, linhas_atualizadas = $6,
			linhas_importadas = $5::int + $6::int, erros = $7, mensagem = nullif($8, ''), finalizada_em = now(), planilha = NULL
		WHERE id = $1 AND status = 'processando' AND tentativas = $2`,
		job.ID, job.Tentativas, string(res.Status), res.TotalLinhas, res.LinhasCriadas, res.LinhasAtualizadas, erros, res.Mensagem)
	if err != nil {
		return fmt.Errorf("postgres: finishing importacao %s: %w", job.ID, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrReivindicacaoPerdida
	}
	return nil
}

// ErroCliente is one row's problem in a client import (the importacao_erros table).
type ErroCliente struct {
	Seq      int64
	Linha    int32
	Campo    string
	Email    string
	Mensagem string
}

// Lote is what one batch of a client import changed. The counters are added to the job's; Processadas is
// the new checkpoint, absolute.
type Lote struct {
	Processadas     int32
	Criadas         int32
	Atualizadas     int32
	Falharam        int32
	EmpresasCriadas int32
	Erros           []ErroCliente
}

// Comecar records a client import's row count and renews its lease, before the first batch.
func (r *Importacoes) Comecar(ctx context.Context, job *Job, total int32) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE importacoes SET total_linhas = $3, iniciada_em = now()
		WHERE id = $1 AND status = 'processando' AND tentativas = $2`, job.ID, job.Tentativas, total)
	if err != nil {
		return fmt.Errorf("postgres: starting importacao %s: %w", job.ID, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrReivindicacaoPerdida
	}
	job.TotalLinhas = total
	return nil
}

// Avancar commits one batch of a client import on db (the transaction that also wrote its senioridades):
// the checkpoint, the counters and the batch's errors. It renews the lease too, so a long import that keeps
// moving is never taken back. ErrReivindicacaoPerdida when the claim is gone, which rolls the batch back.
func (r *Importacoes) Avancar(ctx context.Context, db DBTX, job *Job, lote Lote) error {
	tag, err := db.Exec(ctx, `
		UPDATE importacoes
		SET linhas_processadas = $3, linhas_criadas = linhas_criadas + $4, linhas_atualizadas = linhas_atualizadas + $5,
			linhas_importadas = linhas_importadas + $4 + $5, linhas_falharam = linhas_falharam + $6,
			empresas_criadas = empresas_criadas + $7, iniciada_em = now()
		WHERE id = $1 AND status = 'processando' AND tentativas = $2`,
		job.ID, job.Tentativas, lote.Processadas, lote.Criadas, lote.Atualizadas, lote.Falharam, lote.EmpresasCriadas)
	if err != nil {
		return fmt.Errorf("postgres: saving progress of importacao %s: %w", job.ID, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrReivindicacaoPerdida
	}
	if len(lote.Erros) > 0 {
		linhas := make([]int32, len(lote.Erros))
		campos := make([]string, len(lote.Erros))
		emails := make([]string, len(lote.Erros))
		mensagens := make([]string, len(lote.Erros))
		for i, e := range lote.Erros {
			linhas[i], campos[i], emails[i], mensagens[i] = e.Linha, e.Campo, e.Email, e.Mensagem
		}
		// in row order, so seq follows the spreadsheet within a batch
		_, err = db.Exec(ctx, `
			INSERT INTO importacao_erros (importacao_id, linha, campo, email, mensagem)
			SELECT $1, linha, nullif(campo, ''), nullif(email, ''), mensagem
			FROM unnest($2::int[], $3::text[], $4::text[], $5::text[]) WITH ORDINALITY AS e(linha, campo, email, mensagem, n)
			ORDER BY n`, job.ID, linhas, campos, emails, mensagens)
		if err != nil {
			return fmt.Errorf("postgres: saving errors of importacao %s: %w", job.ID, err)
		}
	}
	job.LinhasProcessadas = lote.Processadas
	return nil
}

// Encerrar gives a client import its final status, keeping the counters its batches added up. It also
// drops the stored file.
func (r *Importacoes) Encerrar(ctx context.Context, job *Job, status Status, mensagem string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE importacoes
		SET status = $3, mensagem = nullif($4, ''), finalizada_em = now(), planilha = NULL
		WHERE id = $1 AND status = 'processando' AND tentativas = $2`, job.ID, job.Tentativas, string(status), mensagem)
	if err != nil {
		return fmt.Errorf("postgres: finishing importacao %s: %w", job.ID, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrReivindicacaoPerdida
	}
	return nil
}

// ListarErros returns up to limite errors of a client import after the seq depoisDe, in order.
func (r *Importacoes) ListarErros(ctx context.Context, id string, depoisDe int64, limite int32) ([]ErroCliente, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT seq, linha, coalesce(campo, ''), coalesce(email, ''), mensagem
		FROM importacao_erros WHERE importacao_id = $1 AND seq > $2
		ORDER BY seq LIMIT $3`, id, depoisDe, limite)
	if err != nil {
		if pgCode(err) == pgInvalidTextRep {
			return nil, ErrIDInvalido
		}
		return nil, fmt.Errorf("postgres: listing errors of importacao %s: %w", id, err)
	}
	erros, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ErroCliente, error) {
		var e ErroCliente
		err := row.Scan(&e.Seq, &e.Linha, &e.Campo, &e.Email, &e.Mensagem)
		return e, err
	})
	switch {
	case pgCode(err) == pgInvalidTextRep:
		return nil, ErrIDInvalido
	case err != nil:
		return nil, fmt.Errorf("postgres: listing errors of importacao %s: %w", id, err)
	}
	if len(erros) == 0 {
		// none yet, or no such import: only the second is an error
		var existe bool
		if err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM importacoes WHERE id = $1)`, id).Scan(&existe); err != nil {
			return nil, fmt.Errorf("postgres: reading importacao %s: %w", id, err)
		}
		if !existe {
			return nil, ErrNaoEncontrada
		}
	}
	return erros, nil
}

// Devolver puts a job back in the queue without using up one of its attempts, for a worker that is
// shutting down. It does nothing when the claim is gone.
func (r *Importacoes) Devolver(ctx context.Context, job *Job) error {
	_, err := r.pool.Exec(ctx, `
		WITH devolvida AS (
			UPDATE importacoes
			SET status = 'pendente', iniciada_em = NULL, tentativas = tentativas - 1
			WHERE id = $1 AND status = 'processando' AND tentativas = $2
			RETURNING id
		)
		SELECT pg_notify($3, id::text) FROM devolvida`, job.ID, job.Tentativas, CanalImportacoes)
	if err != nil {
		return fmt.Errorf("postgres: requeueing importacao %s: %w", job.ID, err)
	}
	return nil
}

// keep
// DevolverTravadas hands imports stuck in processando for longer than prazo (their worker crashed or
// hung) back to the queue, or fails them once they have been claimed maxTentativas times, so a
// spreadsheet that crashes the importer can't loop forever. Meant to run on a ticker in every instance;
// concurrent runs are harmless.
func (r *Importacoes) DevolverTravadas(ctx context.Context, prazo time.Duration, maxTentativas int32) (devolvidas, falhas int64, err error) {
	err = r.pool.QueryRow(ctx, `
		WITH travadas AS (
			UPDATE importacoes
			SET status = CASE WHEN tentativas >= $2 THEN 'falhou' ELSE 'pendente' END,
				mensagem = CASE WHEN tentativas >= $2
					THEN format('O processamento foi interrompido %s vezes; envie a planilha de novo', tentativas) END,
				iniciada_em = CASE WHEN tentativas >= $2 THEN iniciada_em END,
				finalizada_em = CASE WHEN tentativas >= $2 THEN now() END,
				planilha = CASE WHEN tentativas >= $2 THEN NULL ELSE planilha END
			WHERE status = 'processando' AND iniciada_em < now() - make_interval(secs => $1)
			RETURNING status
		)
		SELECT count(*) FILTER (WHERE status = 'pendente'), count(*) FILTER (WHERE status = 'falhou')
		FROM travadas`, prazo.Seconds(), maxTentativas).Scan(&devolvidas, &falhas)
	if err != nil {
		return 0, 0, fmt.Errorf("postgres: requeueing stuck importacoes: %w", err)
	}
	if devolvidas > 0 {
		if _, err := r.pool.Exec(ctx, `SELECT pg_notify($1, '')`, CanalImportacoes); err != nil {
			return devolvidas, falhas, fmt.Errorf("postgres: notifying requeued importacoes: %w", err)
		}
	}
	return devolvidas, falhas, nil
}

func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}
