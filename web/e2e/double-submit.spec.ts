import { Page, expect, test } from "@playwright/test";
import { signIn } from "./session";

// One click must mean one record, even when the clicks outrun React.
//
// Every form disables its submit button while saving, but React Query delivers isPending through
// setTimeout(0) and a render, so for that tick the button is still enabled. Before
// useSingleFlightMutation (src/hooks), the second and third cases below created two categorias: each
// click POSTed with its own Idempotency-Key, so the gateway saw two different requests.
//
// Categorias are the subject because nothing in the schema stops two with the same name: a duplicate
// submit shows up as a second row instead of being hidden by a unique index.
//
// Clicks go through page.mouse and element.click(): Playwright's locator.click() waits until the page is
// responsive and the button is enabled, which would wait the race away.

const CREATE = "/api/categorias";

function countCreates(page: Page) {
  const statuses: number[] = [];
  page.on("response", (res) => {
    if (res.request().method() === "POST" && new URL(res.url()).pathname === CREATE) statuses.push(res.status());
  });
  return statuses;
}

async function openNewCategoria(page: Page) {
  await page.goto("/categorias/new");
  await page.locator("#nome").selectOption("MODA");
  const submit = page.locator("button[type=submit]");
  await expect(submit).toBeEnabled();
  return submit;
}

// let anything a second click started reach the server, and the page settle
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
}

test.beforeEach(async ({ page, request }) => {
  await signIn(page, request);
});

test("an ordinary double click creates one categoria", async ({ page }) => {
  const creates = countCreates(page);
  const submit = await openNewCategoria(page);
  await submit.dblclick();
  await settle(page);
  expect(creates).toEqual([201]);
});

test("a double click while the main thread is busy creates one categoria", async ({ page }) => {
  const creates = countCreates(page);
  const submit = await openNewCategoria(page);
  const box = (await submit.boundingBox())!;
  // a 400 ms long task starts in 50 ms; both clicks arrive during it, so the browser queues them and runs
  // them back to back, before React Query's timer can disable the button
  await page.evaluate(() => {
    setTimeout(() => {
      const end = performance.now() + 400;
      while (performance.now() < end);
    }, 50);
  });
  await page.waitForTimeout(100);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page);
  expect(creates).toEqual([201]);
});

test("two clicks in the same task create one categoria", async ({ page }) => {
  const creates = countCreates(page);
  await openNewCategoria(page);
  // what an autoclicker, or Enter held down on the button, produces
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.click();
    button.click();
  });
  await settle(page);
  expect(creates).toEqual([201]);
});
