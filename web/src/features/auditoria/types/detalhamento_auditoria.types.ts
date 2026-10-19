import { z } from "zod/mini";

export const DetalhamentoAuditoriaSchema = z.object({
  id: z.string(),
  nome_do_produto: z.string(),
  valor_anterior: z.union([z.string(), z.number()]), // mysql decimal — api returns it as a string
  valor_atual: z.union([z.string(), z.number()]),
  observacoes_adicionais: z.string(),
});
export type DetalhamentoAuditoria = z.infer<typeof DetalhamentoAuditoriaSchema>;

export const CreateDetalhamentoAuditoriaSchema = z.object({
  nome_do_produto: z.string().check(z.minLength(1, "Informe o nome do produto.")),
  valor_anterior: z.number().check(z.nonnegative("O valor anterior precisa ser positivo.")),
  valor_atual: z.number().check(z.nonnegative("O valor atual precisa ser positivo.")),
  observacoes_adicionais: z.string(),
});
export type CreateDetalhamentoAuditoriaPayload = z.infer<typeof CreateDetalhamentoAuditoriaSchema>;
