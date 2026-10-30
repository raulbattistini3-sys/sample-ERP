// the app is used in pt-BR and en, so a url typed in either language (singular or plural,
// with or without accents) should land on the same page instead of the 404

// first path segment -> canonical route segment (keys are already normalized)
const SECTION_ALIASES: Record<string, string> = {
  // produtos
  products: "products",
  product: "products",
  produtos: "products",
  produto: "products",
  items: "products",
  item: "products",
  itens: "products",

  // categorias
  categorias: "categorias",
  categoria: "categorias",
  categories: "categorias",
  category: "categorias",

  // usuarios
  usuarios: "usuarios",
  usuario: "usuarios",
  users: "usuarios",
  user: "usuarios",

  // auditoria
  auditoria: "auditoria",
  auditorias: "auditoria",
  audit: "auditoria",
  audits: "auditoria",
  auditing: "auditoria",
  auditings: "auditoria",
  audicao: "auditoria",
  audicoes: "auditoria",

  // integracoes
  integracoes: "integracoes",
  integracao: "integracoes",
  integrations: "integracoes",
  integration: "integracoes",

  // clientes
  clientes: "clientes",
  cliente: "clientes",
  customers: "clientes",
  customer: "clientes",

  // public pages
  login: "login",
  entrar: "login",
  signin: "login",
  "sign-in": "login",
  register: "register",
  registrar: "register",
  cadastro: "register",
  cadastrar: "register",
  signup: "register",
  "sign-up": "register",
  "forgot-password": "forgot-password",
  "esqueci-senha": "forgot-password",
  "esqueci-a-senha": "forgot-password",
  "esqueci-minha-senha": "forgot-password",
  "recuperar-senha": "forgot-password",
  "reset-password": "reset-password",
  "redefinir-senha": "reset-password",

  // landing
  home: "",
  inicio: "",
  dashboard: "",
  painel: "",
};

// action segments shared by every section (/produtos/novo -> /products/new)
const ACTION_ALIASES: Record<string, string> = {
  new: "new",
  novo: "new",
  nova: "new",
  create: "new",
  criar: "new",
  add: "new",
  adicionar: "new",
  import: "import",
  importar: "import",
  importacao: "import",
};

// lowercase, strip accents (audição -> audicao) and unify separators
export function normalizeSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // malformed escape — keep the raw segment
  }
  return decoded
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-");
}

// returns the canonical pathname for an aliased url, or null when nothing matches
// (or when the url already is the canonical one, so we never redirect in a loop)
export function resolveAliasedPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const section = SECTION_ALIASES[normalizeSegment(segments[0])];
  if (section === undefined) return null;

  const rest = segments.slice(1).map((segment) => ACTION_ALIASES[normalizeSegment(segment)] ?? segment);
  const resolved = "/" + [section, ...rest].filter(Boolean).join("/");

  return resolved.toLowerCase() === pathname.replace(/\/+$/, "").toLowerCase() ? null : resolved;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

// typos close to a known section (/produtso, /categoira) are only suggested, not redirected
export function suggestPath(pathname: string): string | null {
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first) return null;

  const segment = normalizeSegment(first);
  const maxDistance = segment.length <= 5 ? 1 : 2;

  let best: { section: string; distance: number } | null = null;
  for (const [alias, section] of Object.entries(SECTION_ALIASES)) {
    const distance = levenshtein(segment, alias);
    if (distance <= maxDistance && (!best || distance < best.distance)) best = { section, distance };
  }
  return best ? `/${best.section}` : null;
}
