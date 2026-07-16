import { expect, test, type Page } from "@playwright/test";

test("Focus remains usable in a short laptop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1350, height: 616 });
  await loginAs(page, "ari@syncore.tech");
  await page.goto("/sdr/focus", { waitUntil: "domcontentloaded" });

  const workspace = page.locator(".cockpit");
  await expect(workspace).toBeVisible();

  const metrics = await workspace.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const columns = Array.from(element.querySelectorAll(":scope > div > aside, :scope > div > main"));
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      viewportHeight: window.innerHeight,
      columns: columns.map((column) => {
        const columnBounds = column.getBoundingClientRect();
        const style = window.getComputedStyle(column);
        return {
          bottom: columnBounds.bottom,
          clientHeight: column.clientHeight,
          scrollHeight: column.scrollHeight,
          overflowY: style.overflowY
        };
      })
    };
  });

  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.columns).toHaveLength(3);
  for (const column of metrics.columns) {
    expect(column.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  }

  const dock = workspace.locator(":scope > div > aside").last();
  const dockScroll = await dock.evaluate((element) => {
    const before = element.scrollTop;
    element.scrollTop = Math.max(1, element.scrollHeight - element.clientHeight);
    return {
      before,
      after: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: window.getComputedStyle(element).overflowY
    };
  });
  expect(dockScroll.overflowY).toBe("auto");
  if (dockScroll.scrollHeight > dockScroll.clientHeight) {
    expect(dockScroll.after).toBeGreaterThan(dockScroll.before);
  }
});

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
