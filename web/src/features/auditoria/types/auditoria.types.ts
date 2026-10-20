import { z } from "zod/mini";
import { CreateDetalhamentoAuditoriaSchema } from "./detalhamento_auditoria.types";

export const AcaoEfetuadaEnum = z.enum(["Criacao", "Alteracao", "Delecao"]);
export type AcaoEfetuada = z.infer<typeof AcaoEfetuadaEnum>;

export const acaoEfetuadaLabels: Record<AcaoEfetuada, string> = {
  Criacao: "Criação",
  Alteracao: "Alteração",
  Delecao: "Deleção",
};

export const AuditoriaSchema = z.object({
  id: z.string(),
  acao_efetuada: AcaoEfetuadaEnum,
  data_de_audicao: z.string(),
  usuario_id: z.string(), // the auditor; useAuditorNames resolves it to a name via the usuarios endpoint
  detalhamento_auditoria_id: z.nullable(z.string()),
});
export type Auditoria = z.infer<typeof AuditoriaSchema>;

// follows the API's AuditoriaSchema validator: product ids in `itens`, detalhamento nested
export const CreateAuditoriaSchema = z.object({
  acao_efetuada: AcaoEfetuadaEnum,
  data_de_audicao: z.string(),
  usuario_id: z.string(),
  itens: z.array(z.string()),
  detalhamento_auditoria: CreateDetalhamentoAuditoriaSchema,
});
export type CreateAuditoriaPayload = z.infer<typeof CreateAuditoriaSchema>;

export const AuditoriaFormSchema = z.object({
  acao_efetuada: AcaoEfetuadaEnum,
  data_de_audicao: z.string().check(z.minLength(1, "Informe a data da auditoria")),
  produto_id: z.string().check(z.minLength(1, "Selecione um produto")),
  valor_anterior: z.number("Informe o valor anterior"),
  valor_atual: z.number("Informe o valor atual"),
  observacoes_adicionais: z.string().check(z.trim(), z.minLength(1, "Descreva a auditoria")),
});
export type AuditoriaFormValues = z.infer<typeof AuditoriaFormSchema>;
