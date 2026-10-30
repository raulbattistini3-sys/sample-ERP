import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { ErroLinhaImportacaoDto, ImportacaoDto, StatusImportacaoDto } from "../dtos/importacao_dtos/importacao.dto";

// The importacoes table as the in-API importer's job queue (ImportacaoWorker), with the same lifecycle
// as the Go importer's (importer/postgres/importacoes.go), so a row left by one is valid for the other:
//
//   criar            -> pendente
//   reivindicar      -> processando   (FOR UPDATE SKIP LOCKED, tentativas + 1)
//   renovar          -> still processando: the worker is alive, so iniciada_em moves forward
//   finalizar        -> concluida | rejeitada | falhou
//   devolverTravadas -> processando for too long goes back to pendente, or to falhou once out of tentativas
//
// tentativas doubles as a fencing token: a worker that lost its job to devolverTravadas can no longer
// finalize it. Run finalizar on the transaction that writes the products, so its error rolls them back.

export class ImportacaoPerdidaError extends Error {
  constructor(id: string) {
    super(`importacao ${id} is no longer claimed by this worker`);
  }
}

export type ImportacaoJob = { id: string; usuarioId: string; nomeArquivo: string; planilha: Buffer; tentativas: number };

export type ResultadoImportacao = {
  status: Extract<StatusImportacaoDto, "concluida" | "rejeitada" | "falhou">;
  totalLinhas?: number;
  linhasCriadas?: number;
  linhasAtualizadas?: number;
  erros?: ErroLinhaImportacaoDto[];
  mensagem?: string;
};

// planilha is left out on purpose: only reivindicar needs the bytes
const COLUNAS = sql.raw(`id, status, nome_arquivo, total_linhas, linhas_importadas, linhas_criadas,
  linhas_atualizadas, erros, coalesce(mensagem, '') as mensagem, criada_em, finalizada_em`);

const iso = (value: string | Date | null) => (value === null ? null : new Date(value).toISOString());

const toDto = (r: any): ImportacaoDto => ({
  id: r.id,
  status: r.status,
  nome_arquivo: r.nome_arquivo,
  total_linhas: r.total_linhas,
  linhas_importadas: r.linhas_importadas,
  linhas_criadas: r.linhas_criadas,
  linhas_atualizadas: r.linhas_atualizadas,
  erros: r.erros,
  mensagem: r.mensagem,
  criada_em: iso(r.criada_em),
  finalizada_em: iso(r.finalizada_em),
});

class ImportacaoRepository {
  constructor(private readonly db: DrizzleDB) {}

  async criar(usuarioId: string, nomeArquivo: string, planilha: Buffer): Promise<ImportacaoDto> {
    const { rows } = await this.db.execute(sql`
      insert into importacoes (usuario_id, nome_arquivo, planilha)
      values (${usuarioId}, ${nomeArquivo}, ${planilha})
      returning ${COLUNAS}`);
    return toDto(rows[0]);
  }

  async obter(id: string): Promise<ImportacaoDto | null> {
    const { rows } = await this.db.execute(sql`select ${COLUNAS} from importacoes where id = ${id}`);
    return rows[0] ? toDto(rows[0]) : null;
  }

  // null = nothing queued
  async reivindicar(): Promise<ImportacaoJob | null> {
    const { rows } = await this.db.execute(sql`
      update importacoes
      set status = 'processando', iniciada_em = now(), tentativas = tentativas + 1
      where id = (
        select id from importacoes
        where status = 'pendente'
        order by criada_em
        for update skip locked
        limit 1
      )
      returning id, usuario_id, nome_arquivo, planilha, tentativas`);
    const r = rows[0] as any;
    if (!r) return null;
    return { id: r.id, usuarioId: r.usuario_id, nomeArquivo: r.nome_arquivo, planilha: r.planilha, tentativas: r.tentativas };
  }

  async renovar(job: ImportacaoJob): Promise<void> {
    await this.db.execute(sql`
      update importacoes set iniciada_em = now()
      where id = ${job.id} and status = 'processando' and tentativas = ${job.tentativas}`);
  }

  async finalizar(job: ImportacaoJob, resultado: ResultadoImportacao, db: DrizzleDB = this.db): Promise<void> {
    const { status, totalLinhas = 0, linhasCriadas = 0, linhasAtualizadas = 0, erros = [], mensagem = "" } = resultado;
    const { rowCount } = await db.execute(sql`
      update importacoes
      set status = ${status}, total_linhas = ${totalLinhas}, linhas_criadas = ${linhasCriadas},
        linhas_atualizadas = ${linhasAtualizadas}, linhas_importadas = ${linhasCriadas + linhasAtualizadas},
        erros = ${JSON.stringify(erros)}::jsonb, mensagem = nullif(${mensagem}, ''), finalizada_em = now(), planilha = null
      where id = ${job.id} and status = 'processando' and tentativas = ${job.tentativas}`);
    if (rowCount === 0) throw new ImportacaoPerdidaError(job.id);
  }

  // Imports not renewed for longer than prazoSeconds (their worker crashed) go back to the
  // queue, or fail once claimed maxTentativas times, so a spreadsheet that crashes the API can't loop
  // forever. Concurrent runs are harmless. Returns how many went back to the queue.
  async devolverTravadas(prazoSeconds: number, maxTentativas: number): Promise<number> {
    const { rows } = await this.db.execute(sql`
      with travadas as (
        update importacoes
        set status = case when tentativas >= ${maxTentativas} then 'falhou' else 'pendente' end,
          mensagem = case when tentativas >= ${maxTentativas}
            then format('O processamento foi interrompido %s vezes; envie a planilha de novo', tentativas) end,
          iniciada_em = case when tentativas >= ${maxTentativas} then iniciada_em end,
          finalizada_em = case when tentativas >= ${maxTentativas} then now() end,
          planilha = case when tentativas >= ${maxTentativas} then null else planilha end
        where status = 'processando' and iniciada_em < now() - make_interval(secs => ${prazoSeconds})
        returning status
      )
      select count(*) filter (where status = 'pendente')::int as devolvidas from travadas`);
    return (rows[0] as { devolvidas: number }).devolvidas;
  }
}

export default ImportacaoRepository;
