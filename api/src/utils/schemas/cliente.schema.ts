import { z } from "zod";

// hs_seniority's values, highest first; the ERP's own senioridade uses the same ones
export const SENIORIDADES = ["owner", "partner", "executive", "vp", "director", "manager", "senior", "employee", "entry"] as const;
const ID = /^\d{1,20}$/;

const opcional = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((v) => v || null);

// one form for creating and editing: the fields the ERP writes to HubSpot, plus its own senioridade
export const ClienteSchema = z.object({
  primeiroNome: z
    .string({ required_error: "Informe o nome.", invalid_type_error: "Informe o nome." })
    .trim()
    .min(1, "Informe o nome.")
    .max(100, "O nome aceita até 100 caracteres."),
  sobrenome: opcional(100, "O sobrenome aceita até 100 caracteres."),
  email: opcional(254, "E-mail longo demais.")
    .transform((v) => v?.toLowerCase() ?? null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "E-mail inválido."),
  telefone: opcional(40, "Telefone longo demais.").refine((v) => v === null || /^[+\d\s().-]{8,40}$/.test(v), "Telefone inválido."),
  empresa: opcional(150, "O nome da empresa aceita até 150 caracteres."),
  cargo: opcional(150, "O cargo aceita até 150 caracteres."),
  // the company picked in the form. When there's none but `empresa` has a name, the company with that name
  // is used, or created: so a client is never left "sem empresa" just because only the name was typed.
  // null with no name: the client leaves its company.
  empresaId: z.string().regex(ID, "Empresa inválida.").nullish(),
  // undefined leaves it as it is; null clears the ERP's own (HubSpot's shows again, if any)
  senioridade: z.enum(SENIORIDADES, { errorMap: () => ({ message: "Senioridade inválida." }) }).nullish(),
  // HubSpot's buying role "Decision maker"; undefined leaves the contact's roles as they are
  decisor: z.boolean({ invalid_type_error: "Decisor inválido." }).optional(),
});
export type ClienteInput = z.infer<typeof ClienteSchema>;

export const VinculoSchema = z.object({
  clienteIds: z
    .array(z.string().regex(/^\d{1,20}$/, "id de cliente inválido"))
    .min(1, "Escolha ao menos um cliente.")
    .max(100, "Ligue até 100 clientes por vez."),
});
