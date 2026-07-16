import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("contacts data table", () => {
  test("searches client-side (no server refetch) and syncs to the URL", async ({ page }) => {
    // Count navigation requests to the route — client filtering must not trigger any.
    const navs: string[] = [];
    page.on("request", (r) => {
      if (r.isNavigationRequest() && r.url().includes("/crm/contacts")) navs.push(r.url());
    });

    await loginAs(page, "nora@syncore.tech");
    await page.goto("/crm/contacts", { waitUntil: "networkidle" });

    const search = page.getByPlaceholder(/Search contacts/i);
    await expect(search).toBeVisible();
    const navsBefore = navs.length;

    await search.fill("maya");
    await page.waitForTimeout(400);

    // URL reflects the query, but no server navigation happened.
    await expect(page).toHaveURL(/q=maya/);
    expect(navs.length).toBe(navsBefore);

    // Sorting writes a sort param and is shareable.
    await search.fill("");
    await page.getByRole("button", { name: /^Score/ }).click();
    await expect(page).toHaveURL(/sort=-?score/);

    // The URL state restores on a fresh load.
    const shareable = page.url();
    await page.goto("about:blank");
    await page.goto(shareable, { waitUntil: "networkidle" });
    await expect(page.getByPlaceholder(/Search contacts/i)).toBeVisible();
  });

  test("finds a contact when the phone query uses different formatting", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");
    await page.goto("/crm/contacts", { waitUntil: "networkidle" });

    const search = page.getByPlaceholder(/Search contacts/i);
    const phoneCell = page.locator("tbody tr td").filter({ hasText: /\+?\d[\d\s()-]{8,}/ }).first();
    const displayedPhone = (await phoneCell.innerText()).trim();
    const localDigits = displayedPhone.replace(/\D/g, "").slice(-10);
    const alternateFormat = `(${localDigits.slice(0, 3)}) ${localDigits.slice(3, 6)}-${localDigits.slice(6)}`;

    await search.fill(alternateFormat);

    await expect(page.getByText(displayedPhone, { exact: true }).first()).toBeVisible();
  });
});
