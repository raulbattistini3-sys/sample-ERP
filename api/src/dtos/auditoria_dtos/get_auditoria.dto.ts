import { BaseMessageGet, BaseMessageGetOne } from "../global_get.dto";
import { AuditoriaEntity } from "../../entities/auditoria.entity";
import { AuditoriaResponseDto } from "./auditoria_response.dto";

type ResponseGetAuditorias = BaseMessageGet<AuditoriaResponseDto>;

type ResponseFindAuditoriaById = BaseMessageGetOne<AuditoriaResponseDto>;

type GetUserPreviousAudictionsDto = Omit<
   AuditoriaEntity[],
   "detalhamento_auditoria"
>;

export {
   ResponseGetAuditorias,
   ResponseFindAuditoriaById,
   GetUserPreviousAudictionsDto,
};
