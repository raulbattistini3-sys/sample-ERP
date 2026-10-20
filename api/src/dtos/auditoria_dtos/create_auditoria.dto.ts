import { z } from "zod";
import { CreateAuditoriaSchema } from "../../utils/schemas/auditoria.schema";
import { AuditoriaResponseDto } from "./auditoria_response.dto";
import { NewAuditoriaEntity } from "../../entities/auditoria.entity";
import { NewDetalhamentoAuditoriaEntity } from "../../entities/detalhamento_auditoria.entity";

// POST /auditoria body, after parsing (snake_case, like the rest of the API)
type CreateAuditoriaDto = z.infer<typeof CreateAuditoriaSchema>;

// what the repository inserts in one transaction; the auditoria's detalhamento id is filled in there
type NewAuditoriaWithItens = {
   auditoria: Omit<NewAuditoriaEntity, "detalhamentoAuditoriaId">;
   detalhamento: NewDetalhamentoAuditoriaEntity;
   produtoIds: string[];
};

type ResponseCreateAuditoria = AuditoriaResponseDto;

export { CreateAuditoriaDto, NewAuditoriaWithItens, ResponseCreateAuditoria };
