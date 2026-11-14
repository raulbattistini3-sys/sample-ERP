import { z } from "zod";
import { listaDeEmails } from "./copias.schema";

const ID = /^\d{1,20}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

const reais = (mensagem: string) =>
  z.number({ invalid_type_error: mensagem, required_error: mensagem }).min(1, "O valor mínimo é R$ 1,00.").max(1_000_000, "O valor máximo é R$ 1.000.000,00.");
const data = z.string().regex(DATA, "Data inválida.").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida.");

const Valores = z.object({
  valor: reais("Informe o valor de cada cobrança."),
  valorMaximo: reais("Informe o valor máximo autorizado."),
  valorMinimo: reais("Valor mínimo inválido.").nullish(),
  cc: listaDeEmails("CC"),
  cco: listaDeEmails("CCO"),
});

const checarValores = (v: { valor: number; valorMaximo: number; valorMinimo?: number | null }, ctx: z.RefinementCtx) => {
  if (v.valorMaximo < v.valor) ctx.addIssue({ code: "custom", path: ["valorMaximo"], message: "O valor máximo precisa ser maior ou igual ao valor da cobrança." });
  if (v.valorMinimo != null && v.valorMinimo > v.valor) ctx.addIssue({ code: "custom", path: ["valorMinimo"], message: "O valor mínimo precisa ser menor ou igual ao valor da cobrança." });
};

export const PlanoSchema = Valores.extend({
  clienteId: z.string({ required_error: "Escolha o cliente." }).regex(ID, "id de cliente inválido"),
  descricao: z.string().trim().min(1, "Informe a descrição.").max(200, "A descrição aceita até 200 caracteres."),
  intervalo: z.number({ invalid_type_error: "Informe a frequência." }).int("A frequência é um número inteiro."),
  unidade: z.enum(["dias", "meses"], { errorMap: () => ({ message: "Escolha dias ou meses." }) }),
  vencimentoDias: z.number().int().min(1, "O prazo para pagar vai de 1 a 60 dias.").max(60, "O prazo para pagar vai de 1 a 60 dias.").default(3),
  dataInicio: data,
  dataFim: data.nullish(),
})
  .superRefine(checarValores)
  .superRefine((v, ctx) => {
    const [min, max] = v.unidade === "meses" ? [1, 12] : [1, 365];
    if (v.intervalo < min || v.intervalo > max) {
      ctx.addIssue({ code: "custom", path: ["intervalo"], message: v.unidade === "meses" ? "A cada 1 a 12 meses." : "A cada 1 a 365 dias." });
    }
    if (v.dataFim && v.dataFim < v.dataInicio) ctx.addIssue({ code: "custom", path: ["dataFim"], message: "O fim precisa ser depois do início." });
  });

// what can change on a running plan: not the client, the frequency or the start (that's a new plan)
export const AlteracaoSchema = Valores.extend({
  descricao: z.string().trim().min(1, "Informe a descrição.").max(200, "A descrição aceita até 200 caracteres."),
  vencimentoDias: z.number().int().min(1).max(60),
  dataFim: data.nullish(),
}).superRefine(checarValores);
