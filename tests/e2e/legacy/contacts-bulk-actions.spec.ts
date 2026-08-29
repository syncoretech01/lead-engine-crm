import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("contacts bulk actions", () => {
  test("selecting rows reveals the bulk bar and a bulk status change applies", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");
    await page.goto("/crm/contacts", { waitUntil: "networkidle" });

    // Row checkboxes (index 0 is the header select-all).
    const checkboxes = page.getByRole("checkbox");
    await expect(checkboxes.first()).toBeVisible();
    await checkboxes.nth(1).click();
    await checkboxes.nth(2).click();

    // Floating bulk bar shows the count.
    await expect(page.getByText(/2 selected/)).toBeVisible();

    // Bulk status change goes through one server action and toasts.
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menuitem", { name: "Interested" }).click();
    await expect(page.getByText(/Status updated/)).toBeVisible({ timeout: 10_000 });
  });
});
