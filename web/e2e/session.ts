import { APIRequestContext, Page, expect } from "@playwright/test";

// The account the specs use: the bootstrap superuser (BOOTSTRAP_SU_* / ERP_ADMIN_*). On a fresh database
// it still has the provisional password and must change it before anything else, so the first run does
// that, and later runs sign in with E2E_PASSWORD directly.
const EMAIL = process.env.E2E_EMAIL ?? "admin@sample-erp.local";
const PROVISIONAL = process.env.E2E_PROVISIONAL_PASSWORD ?? "change-me";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-senha-123";

type LoginResponse = { token: string; trocaSenhaObrigatoria?: boolean } & Record<string, unknown>;

async function login(api: APIRequestContext, senha: string) {
  const res = await api.post("/api/user/login", { data: { email: EMAIL, senha } });
  return res.ok() ? ((await res.json()) as LoginResponse) : null;
}

// On a fresh database the API creates the bootstrap superuser just after it starts listening, so the
// first sign-in can arrive a moment before the account exists.
async function firstLogin(api: APIRequestContext) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const existing = await login(api, PASSWORD);
    if (existing) return { response: existing, password: PASSWORD };
    const provisional = await login(api, PROVISIONAL);
    if (provisional) return { response: provisional, password: PROVISIONAL };
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function session(api: APIRequestContext): Promise<LoginResponse> {
  const found = await firstLogin(api);
  if (found && !found.response.trocaSenhaObrigatoria) return found.response;
  const first = found?.response ?? null;
  expect(first, `cannot sign in as ${EMAIL} with E2E_PASSWORD or the provisional password`).not.toBeNull();
  const current = found!.password;
  const changed = await api.post("/api/user/change-password", {
    headers: { Authorization: `Bearer ${first!.token}` },
    data: { senhaAtual: current, novaSenha: PASSWORD },
  });
  expect(changed.ok(), await changed.text()).toBe(true);
  return (await changed.json()) as LoginResponse;
}

// what the session store restores on load (stores/session.store.ts via lib/auth-storage.ts): the token and
// the user, in localStorage
export async function signIn(page: Page, api: APIRequestContext) {
  const { token, ...user } = await session(api);
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem("token", t);
      localStorage.setItem("user", u);
    },
    [token, JSON.stringify(user)] as const,
  );
  return token;
}
