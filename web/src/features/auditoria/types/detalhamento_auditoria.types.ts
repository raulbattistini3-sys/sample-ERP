import { z } from "zod/mini";

// decimals come back as strings (drizzle decimal without mode:"number")
export const DetalhamentoAuditoriaSchema = z.object({
  id: z.string(),
  nome_do_produto: z.string(),
  valor_anterior: z.string(),
  valor_atual: z.string(),
  observacoes_adicionais: z.string(),
  // every field the auditoria changed; empty on older auditorias, which only kept the valor de venda
  alteracoes: z.array(z.object({ campo: z.string(), antes: z.string(), depois: z.string() })),
});
export type DetalhamentoAuditoria = z.infer<typeof DetalhamentoAuditoriaSchema>;

export const CreateDetalhamentoAuditoriaSchema = z.omit(DetalhamentoAuditoriaSchema, { id: true, alteracoes: true });
export type CreateDetalhamentoAuditoriaPayload = z.infer<typeof CreateDetalhamentoAuditoriaSchema>;
