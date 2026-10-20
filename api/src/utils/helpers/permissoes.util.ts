import permissoesUsuarioEnum from "../../enums/usuarios_permissoes.enum";

const { ADM, SU } = permissoesUsuarioEnum.Values;

// ADM and SU: open user management, see inactive products
export const isAdminRole = (permissoes?: string) => permissoes === ADM || permissoes === SU;

// only SU manages ADM/SU accounts (create, promote to, demote, archive, delete)
export const isSu = (permissoes?: string) => permissoes === SU;
