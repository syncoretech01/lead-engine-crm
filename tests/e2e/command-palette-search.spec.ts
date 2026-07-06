import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("command palette record search", () => {
  test("searches records by name and navigates on select", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");
    await page.goto("/crm/contacts", { waitUntil: "networkidle" });

    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByPlaceholder(/Search records/i);
    await expect(input).toBeVisible();

    await input.fill("maya");
    const result = page.getByRole("option", { name: /Maya Hernandez/i });
    await expect(result).toBeVisible({ timeout: 10_000 });

    await result.click();
    await page.waitForURL(/\/crm\/contacts\/.+/);
  });
});
