// Which environment this build talks to: VITE_ENVIRONMENT (web/.env), e.g. "development", "dev.local",
// "production". Anything starting with "dev" is a development environment. Unset, it follows Vite's mode:
// development under the dev server (`vite`), production in builds (`vite build`).
const declarado = import.meta.env.VITE_ENVIRONMENT?.trim().toLowerCase();
export const AMBIENTE = declarado || (import.meta.env.DEV ? "development" : "production");
export const EM_DESENVOLVIMENTO = AMBIENTE.startsWith("dev");
export const EM_PRODUCAO = AMBIENTE.startsWith("prod");

// The search timing lines (products, Clientes, Empresas). VITE_SEARCH_TIMINGS=true|false forces them;
// unset, they show only in a development environment.
const timings = import.meta.env.VITE_SEARCH_TIMINGS?.trim().toLowerCase();
export const SHOW_SEARCH_TIMINGS = timings === "true" ? true : timings === "false" ? EM_PRODUCAO : EM_DESENVOLVIMENTO;
