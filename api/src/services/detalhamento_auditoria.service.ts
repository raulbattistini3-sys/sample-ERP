import {
   PayloadCreateDetalhamentoAuditoriaDto,
   ResponseCreateDetalhamentoAuditoriaDto,
} from "../dtos/detalhamento_auditoria/create_detalhamentos_auditoria.dto";
import {
   ResponseFindDetalhamentoAuditoriaDto,
   ResponseGetDetalhamentosAuditoriaDto,
} from "../dtos/detalhamento_auditoria/get_detalhamentos_auditoria.dto";
import { PayloadUpdateDetalhamentoAuditoriaDto } from "../dtos/detalhamento_auditoria/update_detalhamentos_auditoria.dto";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import IDetalhamentoAuditoriaService from "../interfaces/detalhamento_auditoria_interfaces/detalhamento_auditoria_service.interface";
import DetalhamentoAuditoriaRepository from "../repositories/detalhamento_auditoria.repository";
import DetalhamentoAuditoriaValidator from "../validators/detalhamento_auditoria.validator";
import { ServerError } from "../errors/server_errors/five_xx.error";
import paginate from "../utils/helpers/paginate_data.helper";

class DetalhamentoAuditoriaService implements IDetalhamentoAuditoriaService {
   constructor(
      private detalhamentoAuditoriaRepository: DetalhamentoAuditoriaRepository,
      private detalhamentoAuditoriaValidator: DetalhamentoAuditoriaValidator,
   ) {}
   async getDetalhamentosAuditoria(
      page: number,
      amount: number,
   ): Promise<Either<BaseAppError, ResponseGetDetalhamentosAuditoriaDto>> {
      try {
         const validation =
            this.detalhamentoAuditoriaValidator.validatePageAndAmount(
               page,
               amount,
            );
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const detalhamentosAuditoria =
            await this.detalhamentoAuditoriaRepository.getDetalhamentoAuditorias();
         if (detalhamentosAuditoria.isLeft()) {
            return left(new ServerError("500", true, "internal server error"));
         }
         const paginatedData = paginate(
            detalhamentosAuditoria.value,
            page,
            amount,
         );
         const response: ResponseGetDetalhamentosAuditoriaDto = {
            data: paginatedData.data,
            pageNumber: paginatedData.currentPage,
            pageSize: paginatedData.perPage,
            totalItems: paginatedData.totalItems,
         };

         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error"));
      }
   }
   async findDetalhamentoAuditoriaById(
      id: string,
   ): Promise<Either<BaseAppError, ResponseFindDetalhamentoAuditoriaDto>> {
      try {
         const validation =
            this.detalhamentoAuditoriaValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const detalhamentoAuditoria =
            await this.detalhamentoAuditoriaRepository.getDetalhamentoAuditoriasById(
               id,
            );
         if (detalhamentoAuditoria.isLeft()) {
            if (detalhamentoAuditoria.value instanceof ValidationError) {
               return left(detalhamentoAuditoria.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         }
         const response: ResponseFindDetalhamentoAuditoriaDto = {
            data: detalhamentoAuditoria.value,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error"));
      }
   }
   async createDetalhamentAuditoria(
      payload: PayloadCreateDetalhamentoAuditoriaDto,
   ): Promise<Either<BaseAppError, ResponseCreateDetalhamentoAuditoriaDto>> {
      try {
         const validation =
            this.detalhamentoAuditoriaValidator.validatePayload(payload);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const detalhamentoAuditoria =
            await this.detalhamentoAuditoriaRepository.createDetalhamentoAuditoria(
               payload,
            );
         if (detalhamentoAuditoria.isLeft()) {
            return left(detalhamentoAuditoria.value);
         }
         const response: ResponseCreateDetalhamentoAuditoriaDto =
            detalhamentoAuditoria.value;
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error"));
      }
   }
   async updateDetalhamentoAuditoria(
      payload: PayloadUpdateDetalhamentoAuditoriaDto,
   ): Promise<Either<BaseAppError, void>> {
      try {
         const validation =
            this.detalhamentoAuditoriaValidator.validatePayload(payload);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const detalhamentoAuditoria =
            await this.detalhamentoAuditoriaRepository.updateDetalhamentoAuditoria(
               payload,
            );
         if (detalhamentoAuditoria.isLeft()) {
            return left(detalhamentoAuditoria.value);
         }
         return right(undefined);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error"));
      }
   }
   async deleteDetalhamentoAuditoria(
      id: string,
   ): Promise<Either<BaseAppError, void>> {
      try {
         const validation =
            this.detalhamentoAuditoriaValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const detalhamentoAuditoria =
            await this.detalhamentoAuditoriaRepository.archiveDetalhamentoAuditoria(
               id,
            );
         if (detalhamentoAuditoria.isLeft()) {
            return left(detalhamentoAuditoria.value);
         }
         return right(undefined);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error"));
      }
   }
   async archiveDetalhamentoAuditoria(
      id: string,
   ): Promise<Either<BaseAppError, void>> {
      try {
         const validation =
            this.detalhamentoAuditoriaValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const detalhamentoAuditoria =
            await this.detalhamentoAuditoriaRepository.archiveDetalhamentoAuditoria(
               id,
            );
         if (detalhamentoAuditoria.isLeft()) {
            return left(detalhamentoAuditoria.value);
         }
         return right(undefined);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error"));
      }
   }
}

export default DetalhamentoAuditoriaService ;
