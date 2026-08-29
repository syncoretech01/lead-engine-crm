import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("contact detail activity timeline", () => {
  test("renders the filterable timeline and the task list", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");

    // Reach a contact detail via the peek's "Open full record".
    await page.goto("/crm/contacts", { waitUntil: "networkidle" });
    await page.getByText("Maya Hernandez").first().click();
    await page.getByRole("link", { name: /Open full record/i }).click();
    await page.waitForURL(/\/crm\/contacts\/.+/);

    // The unified timeline is present with an "All" filter chip.
    await expect(page.getByText("Timeline").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();

    // The optimistic task list renders a Complete affordance when work exists.
    const complete = page.getByRole("button", { name: /Complete/i }).first();
    await expect(complete).toBeVisible();
  });
});
