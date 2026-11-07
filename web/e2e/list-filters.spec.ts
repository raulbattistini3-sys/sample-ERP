import { expect, test } from "@playwright/test";
import { session, signIn } from "./session";

// Multi-select list filters: pick several values of one attribute and the list keeps the rows matching
// any of them; the choice lives in the URL, so it survives a reload.

const WANTED = ["ELETRONICOS", "INFORMATICA"];

test.beforeAll(async ({ request }) => {
  // enough products across all ten categorias for the filter to have something to leave out
  // (/dev/fake-data exists only with API_ENV=development, like the launcher's stack)
  const { token } = await session(request);
  const res = await request.post("/api/dev/fake-data/produtos", {
    headers: { Authorization: `Bearer ${token}` },
    data: { quantidade: 300 },
  });
  expect(res.status(), await res.text()).toBe(201);
});

test("products filtered by two categorias show only those two", async ({ page, request }) => {
  await signIn(page, request);
  await page.goto("/products");
  await expect(page.locator("tbody tr").first()).toBeVisible();

  await page.getByRole("button", { name: /^Categoria/ }).click();
  const group = page.getByRole("group", { name: "Filtrar por Categoria" });
  for (const nome of WANTED) {
    await group.getByText(nome, { exact: true }).click();
  }
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL(/categoria=ELETRONICOS/);
  await expect(page).toHaveURL(/categoria=INFORMATICA/);
  await expect(page.getByRole("button", { name: /Categoria: 2 selecionados/ })).toBeVisible();

  // every row on screen is in one of the two (the first page, in name order, may hold only one of them;
  // the API test below reads enough rows to see both)
  const categoriaCells = page.locator("tbody tr td:nth-child(3)");
  const onlyWanted = async () => {
    const shown = await categoriaCells.allInnerTexts();
    return shown.length > 0 && shown.every((c) => WANTED.includes(c));
  };
  await expect.poll(onlyWanted).toBe(true);

  // the filter is in the URL: a reload shows the same rows
  await page.reload();
  await expect(categoriaCells.first()).toBeVisible();
  expect(await onlyWanted()).toBe(true);

  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page).not.toHaveURL(/categoria=/);
});

test("the API applies the same filter and rejects unknown values", async ({ request }) => {
  const { token } = await session(request);
  const headers = { Authorization: `Bearer ${token}` };

  const res = await request.get("/api/products/scroll?amount=200&categoria=ELETRONICOS&categoria=INFORMATICA", { headers });
  expect(res.status()).toBe(200);
  const { data } = (await res.json()) as { data: { categoria: { nome: string } }[] };
  expect(data.length).toBeGreaterThan(0);
  expect(new Set(data.map((p) => p.categoria.nome))).toEqual(new Set(WANTED));

  const bad = await request.get("/api/products/scroll?categoria=BRINQUEDOS", { headers });
  expect(bad.status()).toBe(400);
});

test("usuarios filtered by permissão and status", async ({ request }) => {
  const { token } = await session(request);
  const headers = { Authorization: `Bearer ${token}` };
  const res = await request.get("/api/user?amount=200&permissoes=SU&status=ativo", { headers });
  expect(res.status()).toBe(200);
  const { data } = (await res.json()) as { data: { permissoes: string; ativo: boolean }[] };
  expect(data.length).toBeGreaterThan(0);
  expect(data.every((u) => u.permissoes === "SU" && u.ativo)).toBe(true);
});

// dd/mm/yyyy → yyyy-mm-dd, for comparing days as strings
const isoDay = (br: string) => br.trim().split("/").reverse().join("-");

test("products filtered by a registration period picked on the calendar", async ({ page, request }) => {
  await signIn(page, request);
  await page.goto("/products");
  await expect(page.getByRole("columnheader", { name: "Cadastro" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();

  await page.getByRole("button", { name: /^Cadastro/ }).click();
  const calendar = page.getByRole("dialog", { name: /período de cadastro/ });
  const days = calendar.locator("button[data-day]");
  const start = (await days.first().getAttribute("data-day"))!; // the grid's first cell, a few weeks back
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  // first click marks the start; the span follows the pointer before the second click
  await calendar.locator(`button[data-day="${start}"]`).click();
  await calendar.locator(`button[data-day="${today}"]`).hover();
  await expect(days.nth(3)).toHaveAttribute("aria-pressed", "true");
  await calendar.locator(`button[data-day="${today}"]`).click();
  await expect(calendar).toBeHidden();

  await expect(page).toHaveURL(new RegExp(`cadastro_de=${start}`));
  await expect(page).toHaveURL(new RegExp(`cadastro_ate=${today}`));
  const br = (d: string) => d.split("-").reverse().join("/");
  await expect(page.getByRole("button", { name: `Cadastro: ${br(start)} – ${br(today)}` })).toBeVisible();

  // Cadastro is the 6th column; every row shown was registered inside the period
  const cadastroCells = page.locator("tbody tr td:nth-child(6)");
  await expect
    .poll(async () => {
      const shown = (await cadastroCells.allInnerTexts()).map(isoDay);
      return shown.every((d) => d >= start && d <= today);
    })
    .toBe(true);
});

test("the API refuses a malformed or inverted period", async ({ request }) => {
  const { token } = await session(request);
  const headers = { Authorization: `Bearer ${token}` };
  const bare = await request.get("/api/products/scroll?cadastro_desde=2026-11-01", { headers });
  expect(bare.status()).toBe(400); // a bare date says nothing about the time zone
  const inverted = await request.get(
    "/api/products/scroll?cadastro_desde=2026-11-10T03:00:00Z&cadastro_antes=2026-11-01T03:00:00Z",
    { headers },
  );
  expect(inverted.status()).toBe(400);
});

test("the search bar finds a word in the name, or part of the SKU", async ({ page, request }) => {
  await signIn(page, request);
  await page.goto("/products");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const box = page.getByRole("searchbox", { name: /Buscar por/ });
  const names = page.locator("tbody tr td:nth-child(2)");
  const skus = page.locator("tbody tr td:nth-child(1)");

  // Nome is the default: every name shown contains the word, whatever its case
  await box.fill("teclado");
  await expect(page).toHaveURL(/busca=teclado/);
  await expect
    .poll(async () => {
      const shown = await names.allInnerTexts();
      return shown.length > 0 && shown.every((n) => n.toLowerCase().includes("teclado"));
    })
    .toBe(true);

  // SKU can be chosen on an empty box too (it couldn't before), then searches the SKUs instead (the fake
  // ones read FK-INF-…)
  await box.fill("");
  await expect(page).not.toHaveURL(/busca=/);
  await page.getByRole("radio", { name: "SKU" }).click();
  await expect(page.getByRole("radio", { name: "SKU" })).toHaveAttribute("aria-checked", "true");
  await box.fill("-INF-");
  await expect(page).toHaveURL(/busca_por=sku/);
  await expect
    .poll(async () => {
      const shown = await skus.allInnerTexts();
      return shown.length > 0 && shown.every((s) => s.includes("-INF-"));
    })
    .toBe(true);

  await box.press("Escape");
  await expect(page).not.toHaveURL(/busca=/);
});

test("search wildcards are taken literally", async ({ request }) => {
  const { token } = await session(request);
  const res = await request.get("/api/products/scroll?amount=50&busca=%25", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  const { data } = (await res.json()) as { data: { name: string }[] };
  expect(data.every((p) => p.name.includes("%"))).toBe(true); // "%" matches a percent sign, not everything
});
