import { z } from "zod";

// Estoque < ADM < SU (see utils/helpers/permissoes.util.ts)
const permissoesUsuarioEnum = z.enum(["ADM", "Estoque", "SU"]);
export type PermissoesUsuarioEnum = z.infer<typeof permissoesUsuarioEnum>;
export default permissoesUsuarioEnum;