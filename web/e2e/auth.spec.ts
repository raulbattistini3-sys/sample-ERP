import { expect, test } from "@playwright/test";
import { session } from "./session";

// The session store (stores/session.store.ts) through the UI: signing in on the form, the sidebar showing who
// is signed in, signing out, and the protected pages sending a signed-out visitor to /login.

const EMAIL = process.env.E2E_EMAIL ?? "admin@sample-erp.local";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-senha-123";

test("sign in on the form, then sign out", async ({ page, request }) => {
  await session(request); // makes sure the account exists and has E2E_PASSWORD

  await page.goto("/products");
  await expect(page).toHaveURL(/\/login/);

  await page.locator("#email").fill(EMAIL);
  await page.locator("#senha").fill(PASSWORD);
  await page.locator("button[type=submit]").click();

  // back where it was headed, with the user in the sidebar
  await expect(page).toHaveURL(/\/products/);
  await expect(page.getByRole("complementary").getByText(EMAIL)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeTruthy();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => [localStorage.getItem("token"), localStorage.getItem("user")])).toEqual([null, null]);

  // and the protected pages stay closed
  await page.goto("/usuarios");
  await expect(page).toHaveURL(/\/login/);
});

test("a wrong password stays on the login page with a message", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill(EMAIL);
  await page.locator("#senha").fill("not-the-password");
  await page.locator("button[type=submit]").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
