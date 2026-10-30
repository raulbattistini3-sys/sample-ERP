import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import { ImportacaoDto, IniciarImportacaoDto } from "../../dtos/importacao_dtos/importacao.dto";

// The Go importer's ImportadorService. Errors: 400 (bad file or request), 404 (unknown import or
// usuario), 503 (importer not configured or unreachable: the web then falls back to POST /products/import).
interface IImportadorClient {
   iniciarImportacao(input: IniciarImportacaoDto): Promise<Either<BaseAppError, ImportacaoDto>>;
   obterImportacao(id: string): Promise<Either<BaseAppError, ImportacaoDto>>;
   close(): void;
}

export default IImportadorClient;
