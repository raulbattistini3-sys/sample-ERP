import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import { ImportacaoDto, IniciarImportacaoDto } from "../../dtos/importacao_dtos/importacao.dto";

// The importer: the Go ImportadorService, or the API's own when IMPORTER_GRPC_URL is empty. Errors: 400
// (bad file or request), 404 (unknown import or usuario), 503 (the Go importer is unreachable: the web
// then falls back to POST /products/import).
interface IImportadorClient {
   iniciarImportacao(input: IniciarImportacaoDto): Promise<Either<BaseAppError, ImportacaoDto>>;
   obterImportacao(id: string): Promise<Either<BaseAppError, ImportacaoDto>>;
   close(): void;
}

export default IImportadorClient;
