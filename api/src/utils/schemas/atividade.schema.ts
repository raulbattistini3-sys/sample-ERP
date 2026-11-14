import { z } from "zod";
import { ESTAGIOS } from "../../services/hubspot.service";

const ID = /^\d+$/;
const texto = (max: number, obrigatorio: string) => z.string().trim().min(1, obrigatorio).max(max, `Até ${max} caracteres.`);

export const AtividadeSchema = z
  .discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("nota"), corpo: texto(5000, "Escreva a nota.") }),
    z.object({
      tipo: z.literal("email"),
      assunto: texto(200, "Informe o assunto."),
      corpo: texto(10000, "Escreva a mensagem."),
      // false: only registers on the timeline an e-mail sent elsewhere
      enviar: z.boolean().default(true),
    }),
    z.object({
      tipo: z.literal("reuniao"),
      titulo: texto(200, "Informe o título."),
      inicio: z.string().datetime({ offset: true, message: "Data e hora inválidas." }),
      duracaoMinutos: z.number().int().min(5).max(24 * 60).default(30),
      local: z.string().trim().max(500).optional().default(""),
      descricao: z.string().trim().max(5000).optional().default(""),
    }),
  ])
  .and(
    z.object({
      contatoId: z.string().regex(ID, "id de cliente inválido").nullish(),
      empresaId: z.string().regex(ID, "id de empresa inválido").nullish(),
    }),
  )
  .refine((a) => a.contatoId || a.empresaId, { message: "Escolha o cliente ou a empresa." })
  .refine((a) => a.tipo !== "email" || a.contatoId, { message: "O e-mail vai para um cliente: escolha o cliente." });

export const EstagioSchema = z.object({ estagio: z.enum(ESTAGIOS, { errorMap: () => ({ message: "Etapa inválida." }) }) });
export const DonoSchema = z.object({ ownerId: z.string().regex(ID, "Responsável inválido.").nullable() });
