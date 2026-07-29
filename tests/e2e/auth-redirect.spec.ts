import { expect, test } from "@playwright/test";

test("unauthenticated user visiting / is redirected to /login", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
});
