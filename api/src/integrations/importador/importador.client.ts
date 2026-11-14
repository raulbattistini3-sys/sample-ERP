import "dotenv/config";
import { Metadata, ServiceError, status } from "@grpc/grpc-js";
import IImportadorClient from "../../interfaces/importacao_interfaces/importador_client.interface";
import { ErroImportacaoDto, ImportacaoDto, IniciarImportacaoDto, StatusImportacaoDto, TipoImportacaoDto } from "../../dtos/importacao_dtos/importacao.dto";
import { BaseAppError } from "../../errors/global_error.error";
import { ValidationError } from "../../errors/client_errors/four_xx.error";
import { ServerError } from "../../errors/server_errors/five_xx.error";
import { Either, left, right } from "../../globals/errors/left_right_either.error";
import { Importacao, ImportadorServiceClient, StatusImportacao, TipoImportacao } from "../../gen/importador/v1/importador";
import { importadorTransporte } from "./importador.tls";


// the calls are quick (queue a row, read a row); the import itself runs in the importer's workers
const DEADLINE_MS = 10_000;
// except sending the file: a 500,000-client spreadsheet is tens of MB
const DEADLINE_ENVIO_MS = 120_000;
// the largest message the importer accepts (its MAX_IMPORT_FILE_MB, 128 by default) plus some room
const MAX_MENSAGEM = 129 * 1024 * 1024;

const STATUS: Record<StatusImportacao, StatusImportacaoDto | undefined> = {
   [StatusImportacao.STATUS_IMPORTACAO_UNSPECIFIED]: undefined,
   [StatusImportacao.STATUS_IMPORTACAO_PENDENTE]: "pendente",
   [StatusImportacao.STATUS_IMPORTACAO_PROCESSANDO]: "processando",
   [StatusImportacao.STATUS_IMPORTACAO_CONCLUIDA]: "concluida",
   [StatusImportacao.STATUS_IMPORTACAO_REJEITADA]: "rejeitada",
   [StatusImportacao.STATUS_IMPORTACAO_FALHOU]: "falhou",
   [StatusImportacao.UNRECOGNIZED]: undefined,
};

const TIPO_PROTO: Record<TipoImportacaoDto, TipoImportacao> = {
   produtos: TipoImportacao.TIPO_IMPORTACAO_PRODUTOS,
   clientes: TipoImportacao.TIPO_IMPORTACAO_CLIENTES,
   empresas: TipoImportacao.TIPO_IMPORTACAO_EMPRESAS,
};

const tipoDto = (tipo: TipoImportacao): TipoImportacaoDto =>
   tipo === TipoImportacao.TIPO_IMPORTACAO_CLIENTES ? "clientes" : tipo === TipoImportacao.TIPO_IMPORTACAO_EMPRESAS ? "empresas" : "produtos";

const toDto = (i: Importacao): ImportacaoDto => ({
   id: i.id,
   status: STATUS[i.status] ?? "pendente",
   nome_arquivo: i.nomeArquivo,
   total_linhas: i.totalLinhas,
   linhas_importadas: i.linhasImportadas,
   linhas_criadas: i.linhasCriadas,
   linhas_atualizadas: i.linhasAtualizadas,
   erros: i.erros.map(({ linha, campo, mensagem }) => ({ linha, campo, mensagem })),
   mensagem: i.mensagem,
   criada_em: i.criadaEm?.toISOString() ?? null,
   finalizada_em: i.finalizadaEm?.toISOString() ?? null,
   tipo: tipoDto(i.tipo),
   linhas_processadas: i.linhasProcessadas,
   linhas_falharam: i.linhasFalharam,
   empresas_criadas: i.empresasCriadas,
});

// the importer's status.Error messages are already in Portuguese and meant for the user
const SEM_IMPORTADOR = () => new ServerError("503", true, "O importador de planilhas está fora do ar (nenhuma instância registrada na rede).");

const toAppError = (error: ServiceError): BaseAppError => {
   switch (error.code) {
      case status.INVALID_ARGUMENT:
         return new ValidationError("400", error.details, error);
      case status.NOT_FOUND:
         return new ValidationError("404", error.details, error);
      case status.UNAVAILABLE:
      case status.DEADLINE_EXCEEDED:
         return new ServerError("503", true, "O importador de planilhas está indisponível no momento.", error);
      default:
         return new ServerError("500", true, "Falha ao chamar o importador de planilhas", error);
   }
};

const deadline = () => ({ deadline: new Date(Date.now() + DEADLINE_MS) });

// "grpc://127.0.0.1:50051" (how the importer registers on the network) or "importer:50051"
const semEsquema = (endereco: string) => endereco.replace(/^grpc:\/\//, "");

class GrpcImportadorClient implements IImportadorClient {
   private conexao: { endereco: string; client: ImportadorServiceClient } | null = null;

   // a fixed address (IMPORTER_GRPC_URL), or a lookup that finds the importer on the network service each
   // call; the gRPC channel is reused until the importer shows up somewhere else
   // mutual TLS when IMPORTER_TLS_* are set (importador.tls.ts); read once, so bad files stop the startup
   private readonly transporte = importadorTransporte();

   constructor(private readonly address: string | (() => Promise<string | null>)) {}

   private async cliente(): Promise<ImportadorServiceClient | null> {
      const endereco = typeof this.address === "string" ? this.address : await this.address();
      if (!endereco) return null;
      const alvo = semEsquema(endereco);
      if (this.conexao?.endereco !== alvo) {
         this.conexao?.client.close();
         // grpc-js connects lazily, so a configured but stopped importer doesn't stop the API from starting
         this.conexao = {
            endereco: alvo,
            client: new ImportadorServiceClient(alvo, this.transporte.credenciais, {
               ...this.transporte.opcoes,
               "grpc.max_send_message_length": MAX_MENSAGEM,
            }),
         };
      }
      return this.conexao.client;
   }

   iniciarImportacao({ planilha, nomeArquivo, usuarioId, tipo }: IniciarImportacaoDto): Promise<Either<BaseAppError, ImportacaoDto>> {
      const tipoProto = TIPO_PROTO[tipo ?? "produtos"];
      return this.call((client, done) =>
         client.iniciarImportacao(
            { planilha, nomeArquivo, usuarioId, tipo: tipoProto },
            new Metadata(),
            { deadline: new Date(Date.now() + DEADLINE_ENVIO_MS) },
            (error, response) => done(error, response?.importacao),
         ),
      );
   }

   async listarErros(id: string, depoisDe: number, limite: number): Promise<Either<BaseAppError, ErroImportacaoDto[]>> {
      const client = await this.cliente();
      if (!client) return left(SEM_IMPORTADOR());
      return new Promise((resolve) =>
         client.listarErros({ id, depoisDe, limite }, new Metadata(), deadline(), (error, response) => {
            if (error) return resolve(left(toAppError(error)));
            resolve(right((response?.erros ?? []).map(({ seq, linha, campo, email, mensagem }) => ({ seq, linha, campo, email, mensagem }))));
         }),
      );
   }

   obterImportacao(id: string): Promise<Either<BaseAppError, ImportacaoDto>> {
      return this.call((client, done) =>
         client.obterImportacao({ id }, new Metadata(), deadline(), (error, response) => done(error, response?.importacao)),
      );
   }

   close() {
      this.conexao?.client.close();
      this.conexao = null;
   }

   private async call(
      run: (client: ImportadorServiceClient, done: (error: ServiceError | null, importacao?: Importacao) => void) => void,
   ): Promise<Either<BaseAppError, ImportacaoDto>> {
      const client = await this.cliente();
      if (!client) return left(SEM_IMPORTADOR());
      return new Promise((resolve) =>
         run(client, (error, importacao) => {
            if (error) return resolve(left(toAppError(error)));
            if (!importacao) return resolve(left(new ServerError("500", true, "O importador respondeu sem a importação")));
            resolve(right(toDto(importacao)));
         }),
      );
   }
}

export default GrpcImportadorClient;
