import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("opportunity kanban board", () => {
  test("renders draggable cards and moves a stage via the accessible fallback", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");
    await page.goto("/crm/opportunities", { waitUntil: "networkidle" });

    await expect(page.getByText("Stage board")).toBeVisible();
    // Drag handles exist (dnd-kit); the pointer-drag itself is covered manually.
    expect(await page.getByRole("button", { name: /Drag to move stage/i }).count()).toBeGreaterThan(0);

    // The keyboard/mobile fallback moves a card's stage through the same
    // optimistic path as a drag; verify it doesn't error.
    const select = page.getByRole("combobox", { name: /Move to stage/i }).first();
    await expect(select).toBeVisible();
    const before = await select.inputValue();
    const target = before === "Proposal" ? "Qualified" : "Proposal";
    await select.selectOption(target);
    await expect(select).toHaveValue(target);
  });
});
