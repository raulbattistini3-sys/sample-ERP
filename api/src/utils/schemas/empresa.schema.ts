import { z } from "zod";


const opcional = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((v) => v || null);

export const EmpresaSchema = z.object({
  nome: z
    .string({ required_error: "Informe o nome da empresa.", invalid_type_error: "Informe o nome da empresa." })
    .trim()
    .min(1, "Informe o nome da empresa.")
    .max(150, "O nome aceita até 150 caracteres."),
  // HubSpot keys companies by domain; "https://www.acme.com.br/x" becomes "acme.com.br"
  dominio: opcional(253, "Domínio longo demais.")
    .transform((v) => v?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || null)
    .refine((v) => v === null || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v), "Domínio inválido (ex.: empresa.com.br)."),
  // one of HubSpot's own industry values (GET /clientes/empresas/setores)
  setor: opcional(100, "Setor inválido."),
  telefone: opcional(40, "Telefone longo demais.").refine((v) => v === null || /^[+\d\s().-]{8,40}$/.test(v), "Telefone inválido."),
  cidade: opcional(100, "A cidade aceita até 100 caracteres."),
  estado: opcional(100, "O estado aceita até 100 caracteres."),
  pais: opcional(100, "O país aceita até 100 caracteres."),
  site: opcional(500, "Site longo demais.").refine((v) => v === null || /^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(v), "Site inválido."),
  descricao: opcional(2000, "A descrição aceita até 2000 caracteres."),
  emailSac: opcional(254, "E-mail longo demais.")
    .transform((v) => v?.toLowerCase() ?? null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "E-mail de SAC inválido."),
  // undefined leaves the owner as it is (the import and older clients don't send it); null clears it
  responsavelId: z.string().regex(/^\d+$/, "Responsável inválido.").nullish(),
});
export type EmpresaInput = z.infer<typeof EmpresaSchema>;
