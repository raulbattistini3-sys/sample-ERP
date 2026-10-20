import { DetalhamentoAuditoriaEntity } from "../../entities/detalhamento_auditoria.entity";
import { DetalhamentoAuditoriaResponseDto } from "./detalhamento_auditoria_response.dto";

type PayloadCreateDetalhamentoAuditoriaDto = Omit<
   DetalhamentoAuditoriaEntity,
   "id"
>;

type ResponseCreateDetalhamentoAuditoriaDto = DetalhamentoAuditoriaResponseDto;

export {
   PayloadCreateDetalhamentoAuditoriaDto,
   ResponseCreateDetalhamentoAuditoriaDto,
};
