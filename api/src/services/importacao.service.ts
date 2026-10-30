import IImportacaoService, { ArquivoEnviado } from "../interfaces/importacao_interfaces/importacao_service.interface";
import IImportadorClient from "../interfaces/importacao_interfaces/importador_client.interface";
import { ImportacaoDto } from "../dtos/importacao_dtos/importacao.dto";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left } from "../globals/errors/left_right_either.error";

// Spreadsheet imports through the importer (ADM/SU). The file goes as it was uploaded; reading,
// validating and saving it all happen in the importer, with the same rules as POST /products/import.
export class ImportacaoService implements IImportacaoService {
   constructor(private readonly importador: IImportadorClient) {}

   async iniciar(arquivo: ArquivoEnviado | undefined, usuarioId: string): Promise<Either<BaseAppError, ImportacaoDto>> {
      if (!arquivo || arquivo.buffer.length === 0) {
         return left(new ValidationError("400", 'Envie a planilha (.xlsx ou .csv) no campo "planilha".'));
      }
      return this.importador.iniciarImportacao({
         planilha: arquivo.buffer,
         nomeArquivo: arquivo.originalname,
         usuarioId,
      });
   }

   async obter(id: string): Promise<Either<BaseAppError, ImportacaoDto>> {
      return this.importador.obterImportacao(id);
   }
}
