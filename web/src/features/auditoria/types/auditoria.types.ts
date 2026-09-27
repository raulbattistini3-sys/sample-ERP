import { z } from "zod/mini";

export const AcaoEfetuadaEnum = z.enum(["Criacao", "Alteracao", "Delecao"]);

export const AuditoriaSchema = z.object({
  id: z.string(),
  acao_efetuada: AcaoEfetuadaEnum,
  data_de_audicao: z.string(),
  nome_do_auditor: z.string(), // usuario id — see naming note below
  detalhamento_auditoria_id: z.nullable(z.string()),
});
export type Auditoria = z.infer<typeof AuditoriaSchema>;

export const CreateAuditoriaSchema = AuditoriaSchema.omit({ id: true });
export type CreateAuditoriaPayload = z.infer<typeof CreateAuditoriaSchema>;
