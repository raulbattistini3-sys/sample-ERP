import { extname } from "node:path";
import IImportadorClient from "../../interfaces/importacao_interfaces/importador_client.interface";
import { ImportacaoDto, IniciarImportacaoDto } from "../../dtos/importacao_dtos/importacao.dto";
import { BaseAppError } from "../../errors/global_error.error";
import { ValidationError } from "../../errors/client_errors/four_xx.error";
import { ServerError } from "../../errors/server_errors/five_xx.error";
import { Either, left, right } from "../../globals/errors/left_right_either.error";
import ImportacaoRepository from "../../repositories/importacao.repository";
import { pgErrorCode } from "../../utils/helpers/pg_error.util";
import { FORMATOS_PLANILHA, FORMATO_NAO_SUPORTADO } from "./planilha";

const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_INVALID_TEXT_REPRESENTATION = "22P02";

// The importer when IMPORTER_GRPC_URL is empty: same contract as GrpcImportadorClient, but the file is
// queued in the importacoes table and processed by this API's ImportacaoWorker.
class LocalImportadorClient implements IImportadorClient {
   constructor(
      private readonly importacoes: ImportacaoRepository,
      private readonly acordarWorker: () => void,
   ) {}

   async iniciarImportacao({ planilha, nomeArquivo, usuarioId }: IniciarImportacaoDto): Promise<Either<BaseAppError, ImportacaoDto>> {
      const nome = nomeArquivo.trim();
      if (!FORMATOS_PLANILHA.includes(extname(nome).toLowerCase())) {
         return left(new ValidationError("400", FORMATO_NAO_SUPORTADO));
      }
      try {
         const importacao = await this.importacoes.criar(usuarioId, nome, planilha);
         this.acordarWorker();
         return right(importacao);
      } catch (error) {
         if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) {
            return left(new ValidationError("404", "Usuário não encontrado.", error));
         }
         return left(new ServerError("500", true, "Não foi possível registrar a importação.", error));
      }
   }

   async obterImportacao(id: string): Promise<Either<BaseAppError, ImportacaoDto>> {
      try {
         const importacao = await this.importacoes.obter(id);
         return importacao ? right(importacao) : left(new ValidationError("404", "Importação não encontrada."));
      } catch (error) {
         if (pgErrorCode(error) === PG_INVALID_TEXT_REPRESENTATION) {
            return left(new ValidationError("400", "id não é um UUID válido.", error));
         }
         return left(new ServerError("500", true, "Não foi possível consultar a importação.", error));
      }
   }

   close() {}
}

export default LocalImportadorClient;
