import { expect, Page, test } from "@playwright/test";
import { session, signIn } from "./session";

// The product list's local search (features/produtos/search, pkg/tablecore): the first page comes from
// the server, then the visible products arrive as one columnar snapshot and filters and the search bar
// run in the browser, on the main thread or in a Web Worker, without a request per keystroke.

test.beforeAll(async ({ request }) => {
  const { token } = await session(request);
  const res = await request.post("/api/dev/fake-data/produtos", {
    headers: { Authorization: `Bearer ${token}` },
    data: { quantidade: 500 },
  });
  expect(res.status(), await res.text()).toBe(201);
});

const status = (page: Page) => page.getByTestId("search-engine-status");

async function openLocal(page: Page, query = "") {
  await page.goto(`/products${query}`);
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await expect(status(page)).toHaveAttribute("data-mode", "local", { timeout: 30_000 });
}

test("after the snapshot loads, searching makes no request to the server", async ({ page, request }) => {
  await signIn(page, request);
  await openLocal(page);

  const scrolls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/products/scroll")) scrolls.push(r.url());
  });
  const box = page.getByRole("searchbox", { name: /Buscar por/ });
  await box.fill("teclado");
  await expect(page).toHaveURL(/busca=teclado/);
  await expect
    .poll(async () => {
      const names = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
      return names.length > 0 && names.every((n) => /(^|[^\p{L}\p{N}])teclado/iu.test(n));
    })
    .toBe(true);
  const matched = Number(await status(page).getAttribute("data-matched"));
  expect(matched).toBeGreaterThan(0);

  // nothing close to any word: no rows
  await box.fill("xqzwv");
  await expect(status(page)).toHaveAttribute("data-matched", "0");
  await expect(page.locator("tbody tr")).toHaveCount(1); // DataTable's "nothing here" row

  expect(scrolls).toEqual([]);
});

test("a typo still finds the product, and the guess is shown", async ({ page, request }) => {
  await signIn(page, request);
  await openLocal(page);
  const box = page.getByRole("searchbox", { name: /Buscar por/ });

  // swapped letters and a missing accent: no name has a word starting "tecaldo" or "mecanico" is typed
  // without its accent, so both words are matched by similarity
  await box.fill("tecaldo mecanico");
  await expect(status(page)).toHaveAttribute("data-fuzzy", "true");
  await expect(page.getByTestId("search-guesses")).toContainText("teclado");
  await expect
    .poll(async () => {
      const names = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
      return names.length > 0 && names.every((n) => /teclado mec[aâ]nico/i.test(n));
    })
    .toBe(true);

  // an exact word start is not a guess
  await box.fill("teclado");
  await expect(status(page)).toHaveAttribute("data-fuzzy", "false");
  await expect(page.getByTestId("search-guesses")).toHaveCount(0);
});

test("the main thread and the worker return the same products", async ({ page, request }) => {
  await signIn(page, request);
  const results: Record<string, { matched: string | null; skus: string[] }> = {};
  for (const strategy of ["main", "worker"]) {
    await openLocal(page, `?strategy=${strategy}&busca=-INF-&busca_por=sku&categoria=INFORMATICA&categoria=ELETRONICOS`);
    await expect(status(page)).toHaveAttribute("data-target", strategy);
    results[strategy] = {
      matched: await status(page).getAttribute("data-matched"),
      skus: await page.locator("tbody tr td:nth-child(1)").allInnerTexts(),
    };
  }
  expect(Number(results.main.matched)).toBeGreaterThan(0);
  expect(results.worker).toEqual(results.main);
});

test("the server and the browser find the same products", async ({ page, request }) => {
  const token = await signIn(page, request);
  await openLocal(page, "?busca=cabo usb");
  await expect(status(page)).toHaveAttribute("data-mode", "local");
  const local = await page.locator("tbody tr td:nth-child(1)").allInnerTexts();

  const res = await request.get("/api/products/scroll?amount=30&busca=cabo%20usb", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  const { data } = (await res.json()) as { data: { sku: string }[] };
  expect(data.length).toBeGreaterThan(0); // the fake catalog has "Cabo USB-C"
  expect(local.filter((s) => s !== "Nenhum registro encontrado.")).toEqual(data.map((p) => p.sku));
});

test("the snapshot is binary, revalidates with its ETag, and telemetry batches are checked", async ({ request }) => {
  const { token } = await session(request);
  const headers = { Authorization: `Bearer ${token}` };
  const first = await request.get("/api/products/snapshot", { headers });
  expect(first.status()).toBe(200);
  expect(first.headers()["content-type"]).toContain("application/vnd.sample-erp.columnar");
  const body = await first.body();
  expect(body.subarray(0, 4).toString("latin1")).toBe("TCC1");
  const etag = first.headers()["etag"];
  const again = await request.get("/api/products/snapshot", { headers: { ...headers, "If-None-Match": etag } });
  expect(again.status()).toBe(304);

  const ok = await request.post("/api/telemetry", {
    headers,
    data: [{ source: "e2e", type: "probe", ts: 1, data: { ok: true } }],
  });
  expect(ok.status()).toBe(204);
  expect(ok.headers()["x-telemetry"]).toBe("stored"); // the launcher sets TELEMETRY_DIR
  const bad = await request.post("/api/telemetry", { headers, data: [{ nope: 1 }] });
  expect(bad.status()).toBe(400);
});
