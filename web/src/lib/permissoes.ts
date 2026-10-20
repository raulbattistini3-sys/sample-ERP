// mirrors api/src/utils/helpers/permissoes.util.ts; the API is what enforces these

// ADM and SU: user management, inactive products
export const isAdminRole = (permissoes?: string) => permissoes === "ADM" || permissoes === "SU";

// only SU manages ADM/SU accounts
export const isSu = (permissoes?: string) => permissoes === "SU";
