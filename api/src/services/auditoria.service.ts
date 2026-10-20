import { IAuditoriaService } from "../interfaces/auditory_interfaces/auditoria_service.interface";
import {
   PayloadCreateAuditoria,
   ResponseCreateAuditoria,
} from "../dtos/auditoria_dtos/create_auditoria.dto";
import {
   ResponseFindAuditoriaById,
   ResponseGetAuditorias,
} from "../dtos/auditoria_dtos/get_auditoria.dto";
import { PayloadUpdateAuditoria } from "../dtos/auditoria_dtos/update_auditoria.dto";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import paginate from "../utils/helpers/paginate_data.helper";
import { AuditoriaEntity } from "../entities/auditoria.entity";
import { toAuditoriaResponse } from "../mappers/auditoria.mapper";
import acaoEfetuadaEnum from "../enums/acao_efetuada.enum";
import IDetalhamentoAuditoriaRepository from "../interfaces/detalhamento_auditoria_interfaces/detalhamento_auditoria_repository.interface";
import IAuditoryRepository from "../interfaces/auditory_interfaces/auditoria_repository.interface";
import { IAuditoriaValidator } from "../interfaces/auditory_interfaces/auditoria_validator.interface";

class AuditoriaService implements IAuditoriaService {
   constructor(
      private detalhamentoAuditoriaRepository: IDetalhamentoAuditoriaRepository,
      private auditoriaRepository: IAuditoryRepository,
      private auditoriaValidator: IAuditoriaValidator,
   ) {}
   async getAuditorias(
      page: number,
      amount: number,
   ): Promise<Either<BaseAppError, ResponseGetAuditorias>> {
      try {
         const validation = this.auditoriaValidator.validatePageAndAmount(
            page,
            amount,
         );
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const auditorias = await this.auditoriaRepository.getAuditorias();
         if (auditorias.isLeft()) {
            return left(
               new ServerError("500", true, "internal server error", auditorias.value),
            );
         }
         const paginatedData = paginate(auditorias.value, page, amount);
         const response: ResponseGetAuditorias = {
            data: paginatedData.data.map(toAuditoriaResponse),
            pageNumber: paginatedData.currentPage,
            pageSize: paginatedData.perPage,
            totalItems: paginatedData.totalItems,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async findAuditoriasById(
      id: string,
   ): Promise<Either<BaseAppError, ResponseFindAuditoriaById>> {
      try {
         const validation = this.auditoriaValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const auditoria = await this.auditoriaRepository.getAuditoriaById(id);
         if (auditoria.isLeft()) {
            return left(auditoria.value);
         }
         const response: ResponseFindAuditoriaById = {
            data: toAuditoriaResponse(auditoria.value),
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async createAuditoria(
      payload: PayloadCreateAuditoria,
   ): Promise<Either<BaseAppError, ResponseCreateAuditoria>> {
      try {
         const validation = this.auditoriaValidator.validatePayload(payload);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const auditoria =
            await this.auditoriaRepository.createAuditoria(payload);
         if (auditoria.isLeft()) {
            return left(auditoria.value);
         }
         const response: ResponseCreateAuditoria = toAuditoriaResponse(auditoria.value);
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async updateAuditoria(
      payload: PayloadUpdateAuditoria,
   ): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.auditoriaValidator.validatePayload(payload);
         if (validation.isLeft()) {
            return left(validation.value);
         }

         const detalhamentoAuditoria =
            await this.auditoriaRepository.getRespectivoDetalhamentosAuditoriaById(
               payload.id,
            );
         if (detalhamentoAuditoria.isLeft()) {
            return left(detalhamentoAuditoria.value);
         }
         const updatePayload: AuditoriaEntity = {
            id: payload.id,
            itens: payload.itens,
            acao_efetuada:
               payload.acao_efetuada || acaoEfetuadaEnum.Values.Alteracao,
            detalhamento_auditoria:
               detalhamentoAuditoria.value.detalhamento_auditoria,
            data_de_audicao: payload.data_de_audicao,
            nome_do_auditor: payload.nome_do_auditor,
         };

         const auditoria =
            await this.auditoriaRepository.updateAuditoria(updatePayload);
         if (auditoria.isLeft()) {
            return left(auditoria.value);
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async deleteAuditoria(id: string): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.auditoriaValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const auditoriaData = await this.deleteAuditoria(id);
         if (auditoriaData.isLeft()) {
            if (auditoriaData.value instanceof ValidationError) {
               return left(auditoriaData.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async archiveAuditoria(id: string): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.auditoriaValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const auditoriaData =
            await this.auditoriaRepository.softDeleteAuditoria(id);
         if (auditoriaData.isLeft()) {
            if (auditoriaData.value instanceof ValidationError) {
               return left(auditoriaData.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
}

export { AuditoriaService };
