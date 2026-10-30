import { z } from "zod";
import { UpdateAuditoriaSchema } from "../../utils/schemas/auditoria.schema";

// PUT /auditoria/:id body, after parsing (snake_case, like the create payload)
type PayloadUpdateAuditoria = z.infer<typeof UpdateAuditoriaSchema>;

export { PayloadUpdateAuditoria };