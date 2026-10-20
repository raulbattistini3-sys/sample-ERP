import { Categoria } from "../../entities/categoria.entity";
import { BaseAppError } from "../../errors/global_error.error";
import { RepositoryError } from "../../globals/errors/global_repository_error.error";
import { Either } from "../../globals/errors/left_right_either.error";

interface ICategoriaRepository {
    getCategorias(): Promise<Either<RepositoryError, Categoria[]>>;
    getCategoriaById(id: string): Promise<Either<RepositoryError, Categoria>>;
    getCategoriaByName(name: string): Promise<Either<BaseAppError, Categoria>>;
    createCategoria(
        payload: Omit<Categoria, "id">
    ): Promise<Either<RepositoryError, Categoria>>;
    // usuarioId: who made the change; recorded as an "Alteracao" auditoria in the same transaction
    updateCategoria(payload: Categoria, usuarioId: string): Promise<Either<BaseAppError, void>>;
    deactivateCategoria(id: string, usuarioId: string): Promise<Either<BaseAppError, void>>;
    deleteCategoria(id: string): Promise<Either<RepositoryError, void>>;
}

export default ICategoriaRepository;