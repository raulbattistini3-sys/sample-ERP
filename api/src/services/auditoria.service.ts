import { IAuditoriaService } from "../interfaces/auditory_interfaces/auditoria_service.interface";
import { ResponseCreateAuditoria } from "../dtos/auditoria_dtos/create_auditoria.dto";
import {
   ResponseFindAuditoriaById,
   ResponseGetAuditorias,
} from "../dtos/auditoria_dtos/get_auditoria.dto";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import paginate from "../utils/helpers/paginate_data.helper";
import { AuditoriaEntity } from "../entities/auditoria.entity";
import { toAuditoriaResponse, toNewAuditoriaManual, toNewAuditoriaWithItens } from "../mappers/auditoria.mapper";
import IDetalhamentoAuditoriaRepository from "../interfaces/detalhamento_auditoria_interfaces/detalhamento_auditoria_repository.interface";
import IAuditoryRepository from "../interfaces/auditory_interfaces/auditoria_repository.interface";
import { IAuditoriaValidator } from "../interfaces/auditory_interfaces/auditoria_validator.interface";
import FirstPageCache, { FIRST_PAGE_SIZE } from "../utils/cache/first_page.cache";

const PRIMEIRA_PAGINA_BYTES = 64 * 1024;

class AuditoriaService implements IAuditoriaService {
   private readonly primeiraPagina = new FirstPageCache<ResponseGetAuditorias>(PRIMEIRA_PAGINA_BYTES);

   constructor(
      private detalhamentoAuditoriaRepository: IDetalhamentoAuditoriaRepository,
      private auditoriaRepository: IAuditoryRepository,
      private auditoriaValidator: IAuditoriaValidator,
   ) {}
   getAuditorias(
      sessao: string,
      page: number,
      amount: number,
   ): Promise<Either<BaseAppError, ResponseGetAuditorias>> {
      return this.primeiraPagina.read(sessao, page === 1 && amount === FIRST_PAGE_SIZE, () => this.carregarAuditorias(page, amount));
   }
   private async carregarAuditorias(
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
      payload: unknown,
   ): Promise<Either<BaseAppError, ResponseCreateAuditoria>> {
      try {
         const parsed = this.auditoriaValidator.parseCreatePayload(payload);
         if (parsed.isLeft()) {
            return left(parsed.value);
         }
         const auditoria = await this.auditoriaRepository.createAuditoria(
            toNewAuditoriaWithItens(parsed.value),
         );
         if (auditoria.isLeft()) {
            if (auditoria.value instanceof ValidationError) {
               return left(auditoria.value);
            }
            return left(
               new ServerError("500", true, "internal server error", auditoria.value),
            );
         }
         this.primeiraPagina.clear();
         const response: ResponseCreateAuditoria = toAuditoriaResponse(auditoria.value);
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async createAuditoriaManual(
      payload: unknown,
      includeInactive: boolean,
   ): Promise<Either<BaseAppError, ResponseCreateAuditoria>> {
      try {
         const parsed = this.auditoriaValidator.parseCreateManualPayload(payload);
         if (parsed.isLeft()) {
            return left(parsed.value);
         }
         const auditoria = await this.auditoriaRepository.createAuditoriaManual(
            toNewAuditoriaManual(parsed.value, includeInactive),
         );
         if (auditoria.isLeft()) {
            if (auditoria.value instanceof ValidationError) {
               return left(auditoria.value);
            }
            return left(
               new ServerError("500", true, "internal server error", auditoria.value),
            );
         }
         this.primeiraPagina.clear();
         return right(toAuditoriaResponse(auditoria.value));
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async updateAuditoria(payload: unknown): Promise<Either<BaseAppError, null>> {
      try {
         const parsed = this.auditoriaValidator.parseUpdatePayload(payload);
         if (parsed.isLeft()) {
            return left(parsed.value);
         }
         const values = parsed.value;

         // 404 when it doesn't exist; the auditor and detalhamento stay as they were
         const existing = await this.auditoriaRepository.getAuditoriaById(values.id);
         if (existing.isLeft()) {
            return left(existing.value);
         }
         const updatePayload: AuditoriaEntity = {
            ...existing.value,
            acaoEfetuada: values.acao_efetuada,
            dataDeAudicao: values.data_de_audicao,
         };

         const auditoria =
            await this.auditoriaRepository.updateAuditoria(updatePayload);
         if (auditoria.isLeft()) {
            return left(auditoria.value);
         }
         this.primeiraPagina.clear();
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
         this.primeiraPagina.clear();
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
         this.primeiraPagina.clear();
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
