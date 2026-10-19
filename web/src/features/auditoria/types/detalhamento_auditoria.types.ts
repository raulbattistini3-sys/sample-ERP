import { z } from "zod/mini";

export const AcaoEfetuadaEnum = z.enum(["Criacao", "Alteracao", "Delecao"]);
export const DetalhamentoAuditoriaSchema = z.object({
  id: z.string(),
  acao_efetuada: AcaoEfetuadaEnum,
  data_de_audicao: z.string(),
  nome_do_auditor: z.string(), // usuario id — see naming note below
  detalhamento_auditoria_id: z.nullable(z.string()),
});
export type DetalhamentoAuditoria = z.infer<typeof DetalhamentoAuditoriaSchema>;

export const CreateDetalhamentoAuditoriaSchema = DetalhamentoAuditoriaSchema.omit({ id: true });
export type CreateDetalhamentoAuditoriaPayload = z.infer<typeof CreateDetalhamentoAuditoriaSchema>;
