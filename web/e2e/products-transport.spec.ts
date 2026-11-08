import { expect, test } from "@playwright/test";
import { signIn } from "./session";

// The product list's transports (features/produtos/api/product.api.ts): REST, or a WebSocket with protobuf
// frames (?transport=socket). These run behind the launcher's gateway, which doesn't forward sockets yet,
// so the socket must fall back to REST there without the user noticing.

type TransportEvent = { source: string; type: string; data: Record<string, unknown> };
const transportEvents = () =>
  ((window as unknown as { __erpTelemetry?: { events: TransportEvent[] } }).__erpTelemetry?.events ?? []).filter(
    (e) => e.source === "transport",
  );

test("?transport=socket behind the gateway falls back to REST, and the list still loads", async ({ page, request }) => {
  await signIn(page, request);
  const scrolls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/products/scroll")) scrolls.push(r.url());
  });
  await page.goto("/products?transport=socket");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  expect(scrolls.length).toBeGreaterThan(0);

  const events = await page.evaluate(transportEvents);
  const socket = events.find((e) => e.data.transport === "socket");
  const rest = events.find((e) => e.data.transport === "rest");
  expect(socket?.data).toMatchObject({ requested: "socket", ok: false, fallback: true });
  expect(rest?.data).toMatchObject({ requested: "socket", ok: true, cold: true });
});

test("REST is the default, and each request is timed", async ({ page, request }) => {
  await signIn(page, request);
  await page.goto("/products");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const events = await page.evaluate(transportEvents);
  expect(events.length).toBeGreaterThan(0);
  expect(events[0].data).toMatchObject({ requested: "rest", transport: "rest", ok: true, cold: true, page: "first" });
  expect(typeof events[0].data.ms).toBe("number");
});
