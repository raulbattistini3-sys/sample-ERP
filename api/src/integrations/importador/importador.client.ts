import "dotenv/config";
import { credentials, Metadata, ServiceError, status } from "@grpc/grpc-js";
import IImportadorClient from "../../interfaces/importacao_interfaces/importador_client.interface";
import { ImportacaoDto, IniciarImportacaoDto, StatusImportacaoDto } from "../../dtos/importacao_dtos/importacao.dto";
import { BaseAppError } from "../../errors/global_error.error";
import { ValidationError } from "../../errors/client_errors/four_xx.error";
import { ServerError } from "../../errors/server_errors/five_xx.error";
import { Either, left, right } from "../../globals/errors/left_right_either.error";
import { Importacao, ImportadorServiceClient, StatusImportacao } from "../../gen/importador/v1/importador";


// both calls are quick (queue a row, read a row); the import itself runs in the importer's workers
const DEADLINE_MS = 10_000;

const STATUS: Record<StatusImportacao, StatusImportacaoDto | undefined> = {
   [StatusImportacao.STATUS_IMPORTACAO_UNSPECIFIED]: undefined,
   [StatusImportacao.STATUS_IMPORTACAO_PENDENTE]: "pendente",
   [StatusImportacao.STATUS_IMPORTACAO_PROCESSANDO]: "processando",
   [StatusImportacao.STATUS_IMPORTACAO_CONCLUIDA]: "concluida",
   [StatusImportacao.STATUS_IMPORTACAO_REJEITADA]: "rejeitada",
   [StatusImportacao.STATUS_IMPORTACAO_FALHOU]: "falhou",
   [StatusImportacao.UNRECOGNIZED]: undefined,
};

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
});

// the importer's status.Error messages are already in Portuguese and meant for the user
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

class GrpcImportadorClient implements IImportadorClient {
   private readonly client: ImportadorServiceClient;

   constructor(address: string) {
      // grpc-js connects lazily, so a configured but stopped importer doesn't stop the API from starting
      this.client = new ImportadorServiceClient(address, credentials.createInsecure());
   }

   iniciarImportacao({ planilha, nomeArquivo, usuarioId }: IniciarImportacaoDto): Promise<Either<BaseAppError, ImportacaoDto>> {
      return this.call((client, done) =>
         client.iniciarImportacao({ planilha, nomeArquivo, usuarioId }, new Metadata(), deadline(), (error, response) =>
            done(error, response?.importacao),
         ),
      );
   }

   obterImportacao(id: string): Promise<Either<BaseAppError, ImportacaoDto>> {
      return this.call((client, done) =>
         client.obterImportacao({ id }, new Metadata(), deadline(), (error, response) => done(error, response?.importacao)),
      );
   }

   close() {
      this.client.close();
   }

   private call(
      run: (client: ImportadorServiceClient, done: (error: ServiceError | null, importacao?: Importacao) => void) => void,
   ): Promise<Either<BaseAppError, ImportacaoDto>> {
      return new Promise((resolve) =>
         run(this.client, (error, importacao) => {
            if (error) return resolve(left(toAppError(error)));
            if (!importacao) return resolve(left(new ServerError("500", true, "O importador respondeu sem a importação")));
            resolve(right(toDto(importacao)));
         }),
      );
   }
}

export default GrpcImportadorClient;
