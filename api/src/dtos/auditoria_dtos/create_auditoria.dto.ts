import { z } from "zod";
import { CreateAuditoriaManualSchema, CreateAuditoriaSchema } from "../../utils/schemas/auditoria.schema";
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

// POST /auditoria/manual body, after parsing
type CreateAuditoriaManualDto = z.infer<typeof CreateAuditoriaManualSchema>;

// what the repository applies and records in one transaction
type NewAuditoriaManual = {
   acao: CreateAuditoriaManualDto["acao_efetuada"];
   dataDeAudicao: Date;
   usuarioId: string;
   observacoes: string;
   alvo: CreateAuditoriaManualDto["alvo"];
   // only ADM/SU change a product's status or audit an inactive product (like PUT /products/:id)
   includeInactive: boolean;
};

type ResponseCreateAuditoria = AuditoriaResponseDto;

export {
   CreateAuditoriaDto,
   NewAuditoriaWithItens,
   CreateAuditoriaManualDto,
   NewAuditoriaManual,
   ResponseCreateAuditoria,
};
