import { z } from "zod";
import { listaDeEmails } from "./copias.schema";

export const CobrancaSchema = z.object({
  clienteIds: z.array(z.string().regex(/^\d+$/, "id de cliente inválido")).min(1, "Escolha pelo menos um cliente.").max(50, "No máximo 50 clientes por vez."),
  descricao: z.string().trim().min(1, "Informe a descrição.").max(200, "A descrição aceita até 200 caracteres."),
  valor: z.number({ invalid_type_error: "Informe o valor." }).min(1, "O valor mínimo é R$ 1,00.").max(1_000_000, "O valor máximo é R$ 1.000.000,00."),
  vencimentoDias: z.number().int().min(1).max(60).default(7),
  cc: listaDeEmails("CC"),
  cco: listaDeEmails("CCO"),
});
