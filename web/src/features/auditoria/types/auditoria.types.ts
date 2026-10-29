import { z } from "zod/mini";
import { CategoriaNomesEnum, CategoriaTiposEnum } from "../../categoria/types/categoria.types";
import { CreateProductPayload } from "../../produtos/types/produto.types";

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

// POST /auditoria/manual: the auditoria applies `valores` (the whole record as it should end up) to one
// product or categoria and records every field that changed. The auditor is taken from the token.
export type AuditoriaAlvo =
  | { tipo: "produto"; id: string; valores: CreateProductPayload & { ativo: boolean } }
  | { tipo: "categoria"; id: string; valores: { nome: z.infer<typeof CategoriaNomesEnum>; tipo: z.infer<typeof CategoriaTiposEnum>; ativo: boolean } };

export type CreateAuditoriaManualPayload = {
  acao_efetuada: AcaoEfetuada;
  data_de_audicao: string;
  observacoes_adicionais: string;
  alvo: AuditoriaAlvo;
};

export const AlvoTipoEnum = z.enum(["produto", "categoria"]);
export type AlvoTipo = z.infer<typeof AlvoTipoEnum>;

// the fields shared by both targets; the product/categoria fields are checked by their own form schemas
export const AuditoriaFormSchema = z.object({
  acao_efetuada: AcaoEfetuadaEnum,
  data_de_audicao: z.string().check(z.minLength(1, "Informe a data da auditoria")),
  alvo_id: z.string().check(z.minLength(1, "Selecione o que ser� auditado")),
  observacoes_adicionais: z.string().check(z.trim(), z.minLength(1, "Descreva a auditoria")),
});
export type AuditoriaFormValues = z.infer<typeof AuditoriaFormSchema>;
