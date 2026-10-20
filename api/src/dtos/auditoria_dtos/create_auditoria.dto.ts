import { AuditoriaEntity } from "../../entities/auditoria.entity";
import { DetalhamentoAuditoriaEntity } from "../../entities/detalhamento_auditoria.entity";
import { UsuarioEntity } from "../../entities/usuario.entity";
import { AuditoriaResponseDto } from "./auditoria_response.dto";

type PayloadCreateAuditoria = Omit<
   AuditoriaEntity,
   "id" | "detalhamento_auditoria" | "nome_do_auditor"
> & {
   nome_do_auditor: Pick<UsuarioEntity, "nome">;
} & Omit<DetalhamentoAuditoriaEntity, "id" | "auditoria">;

type ResponseCreateAuditoria = AuditoriaResponseDto;

export { PayloadCreateAuditoria, ResponseCreateAuditoria };
