import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("feedback primitives", () => {
  test("ActionForm surfaces a success toast on a server action", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");
    await page.goto("/search-profiles", { waitUntil: "networkidle" });

    // Duplicate is additive and keeps its trigger mounted — the representative
    // ActionForm case. The toast is fired from the awaited action result.
    await page.getByRole("button", { name: "Copy" }).first().click();
    await expect(page.getByText("Search profile duplicated")).toBeVisible({ timeout: 10_000 });
  });

  test("ConfirmSubmit gates a destructive server action behind a dialog", async ({ page }) => {
    await loginAs(page, "nora@syncore.tech");
    await page.goto("/search-profiles", { waitUntil: "networkidle" });

    const deletes = page.getByRole("button", { name: "Delete" });
    const before = await deletes.count();
    expect(before).toBeGreaterThan(0);

    // Opening the dialog must NOT delete anything…
    await deletes.first().click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await deletes.count()).toBe(before);

    // …confirming does.
    await deletes.first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete profile" }).click();
    await expect(deletes).toHaveCount(before - 1, { timeout: 10_000 });
  });
});
