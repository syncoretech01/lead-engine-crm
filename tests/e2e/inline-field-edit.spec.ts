import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("inline contact field editing", () => {
  test("a manager can edit a single field inline and it saves", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");

    await page.goto("/crm/contacts", { waitUntil: "networkidle" });
    await page.getByText("Maya Hernandez").first().click();
    await page.getByRole("link", { name: /Open full record/i }).click();
    await page.waitForURL(/\/crm\/contacts\/.+/);

    // The edit panel now uses click-to-edit inline fields. Edit the phone.
    const phoneButton = page.getByRole("button", { name: /214 555/ }).first();
    await expect(phoneButton).toBeVisible();
    await phoneButton.click();

    const input = page.locator("input[type=tel]").first();
    await input.fill("+1 214 555 9999");
    await input.press("Enter");

    // Single-field save toasts and does not blank the other fields.
    await expect(page.getByText(/Phone updated/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Maya Hernandez")).toBeVisible();
  });
});
