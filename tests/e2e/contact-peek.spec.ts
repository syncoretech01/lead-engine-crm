import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("contact record peek", () => {
  test("clicking a row opens the peek without navigating; checkbox does not", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");
    await page.goto("/crm/contacts", { waitUntil: "networkidle" });

    // Row click opens the side peek fed from row data (no navigation to detail).
    await page.getByText("Maya Hernandez").first().click();
    const peek = page.getByRole("dialog");
    await expect(peek).toBeVisible();
    await expect(peek.getByText(/Open full record/i)).toBeVisible();
    expect(page.url()).not.toMatch(/\/crm\/contacts\/[a-z0-9-]+$/i);

    // Escape closes it; selecting a row checkbox must not reopen it.
    await page.keyboard.press("Escape");
    await expect(peek).toBeHidden();
    await page.getByRole("checkbox").nth(1).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
