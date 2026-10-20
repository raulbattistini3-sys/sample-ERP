import { ResponseCreateAuditoria } from "../../dtos/auditoria_dtos/create_auditoria.dto";
import {
   ResponseFindAuditoriaById,
   ResponseGetAuditorias,
} from "../../dtos/auditoria_dtos/get_auditoria.dto";
import { PayloadUpdateAuditoria } from "../../dtos/auditoria_dtos/update_auditoria.dto";
import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";

interface IAuditoriaService {
   getAuditorias: (
      page: number,
      amount: number,
   ) => Promise<Either<BaseAppError, ResponseGetAuditorias>>;
   findAuditoriasById: (
      id: string,
   ) => Promise<Either<BaseAppError, ResponseFindAuditoriaById>>;
   // payload is the raw request body; the service validates and coerces it
   createAuditoria: (
      payload: unknown,
   ) => Promise<Either<BaseAppError, ResponseCreateAuditoria>>;
   updateAuditoria: (
      payload: PayloadUpdateAuditoria,
   ) => Promise<Either<BaseAppError, null>>;
   deleteAuditoria: (id: string) => Promise<Either<BaseAppError, null>>;
   archiveAuditoria: (id: string) => Promise<Either<BaseAppError, null>>;
   // TODO implement: doesUserExist: (userId: string) => Promise<Either<BaseAppError, boolean>>;
}

export { IAuditoriaService };
