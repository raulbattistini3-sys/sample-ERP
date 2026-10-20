import {
    BaseMessageGet,
    BaseMessageGetOne,
} from "../global_get.dto";
import { DetalhamentoAuditoriaResponseDto } from "./detalhamento_auditoria_response.dto";

type ResponseGetDetalhamentosAuditoriaDto =
    BaseMessageGet<DetalhamentoAuditoriaResponseDto>;

type ResponseFindDetalhamentoAuditoriaDto =
    BaseMessageGetOne<DetalhamentoAuditoriaResponseDto>;

export {
    ResponseFindDetalhamentoAuditoriaDto,
    ResponseGetDetalhamentosAuditoriaDto,
};