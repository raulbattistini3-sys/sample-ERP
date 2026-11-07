import { expect, test } from "@playwright/test";
import { session } from "./session";

// The gateway's side of the same promise (launcher/sample-erp/src/gateway): a repeated request runs
// once, and a replay with a changed body is refused, whoever sends it.

const body = { nome: "MODA", tipo: "Especial" };

test("a creating POST without an Idempotency-Key is refused", async ({ request }) => {
  const { token } = await session(request);
  const res = await request.post("/api/categorias", { headers: { Authorization: `Bearer ${token}` }, data: body });
  expect(res.status()).toBe(400);
});

test("the same key replays the first response instead of creating again", async ({ request }) => {
  const { token } = await session(request);
  const headers = { Authorization: `Bearer ${token}`, "Idempotency-Key": `e2e-${crypto.randomUUID()}` };

  const first = await request.post("/api/categorias", { headers, data: body });
  expect(first.status()).toBe(201);
  const again = await request.post("/api/categorias", { headers, data: body });
  expect(again.status()).toBe(201);
  expect(again.headers()["idempotent-replayed"]).toBe("true");
  expect(await again.json()).toEqual(await first.json());

  // the man-in-the-middle's move: same key, different body
  const tampered = await request.post("/api/categorias", { headers, data: { ...body, tipo: "Normal" } });
  expect(tampered.status()).toBe(422);
});
