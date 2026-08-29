import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("theme system", () => {
  test("dark mode toggles, persists, and server-renders without a flash", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");

    await page.goto("/crm/contacts", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // Toggle via the user menu
    await page.getByRole("button", { name: /Nora/i }).click();
    await page.getByRole("menuitem", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Preference is a cookie...
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === "syncore_theme")?.value).toBe("dark");

    // ...so the server renders the dark class directly (no flash of light theme).
    const response = await page.request.get("/crm", {
      headers: { cookie: "syncore_theme=dark" }
    });
    expect(await response.text()).toMatch(/<html[^>]*class="[^"]*dark/);

    // Survives reload
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Toggle back to light from the command palette
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/Search or jump/i).fill("theme");
    await page.getByRole("option", { name: /Light theme/i }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("public auth pages respect the dark cookie", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "syncore_theme", value: "dark", domain: "localhost", path: "/" }
    ]);
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await context.close();
  });
});
