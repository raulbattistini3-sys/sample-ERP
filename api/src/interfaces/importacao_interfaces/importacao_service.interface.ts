import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import { ImportacaoDto } from "../../dtos/importacao_dtos/importacao.dto";

export type ArquivoEnviado = { buffer: Buffer; originalname: string };

interface IImportacaoService {
   // queues the uploaded spreadsheet in the importer; the result is polled with obter
   iniciar(arquivo: ArquivoEnviado | undefined, usuarioId: string): Promise<Either<BaseAppError, ImportacaoDto>>;
   obter(id: string): Promise<Either<BaseAppError, ImportacaoDto>>;
}

export default IImportacaoService;
