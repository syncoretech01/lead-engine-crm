import { expect, test, type Page } from "@playwright/test";

const routes = [
  ["/", "Lead command center"],
  ["/search-profiles", "Search profiles"],
  ["/lead-jobs", "Lead jobs"],
  ["/staging", "Lead staging"],
  ["/data-quality", "Data quality"],
  ["/enrichment", "Enrichment and scoring"],
  ["/crm", "CRM workspace"],
  ["/crm/accounts", "Accounts"],
  ["/crm/contacts", "Contacts"],
  ["/crm/opportunities", "Opportunities"],
  ["/sdr/queue", "SDR queue"],
  ["/sdr/manager", "SDR manager dashboard"],
  ["/outreach/campaigns", "Outreach campaigns"],
  ["/outreach/events", "Outreach event tracking"],
  ["/integrations", "Integration Center"],
  ["/access", "User access"],
  ["/reports", "Admin reports"],
  ["/reports/compliance", "Compliance workflows"],
  ["/automation", "AI automation"],
  ["/exports", "Exports"],
  ["/compliance", "Compliance"]
] as const;

const viewports = [
  { name: "desktop", width: 1440, height: 1024 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "mobile", width: 390, height: 844 }
] as const;

test.describe("responsive route coverage", () => {
  for (const viewport of viewports) {
    for (const [path, heading] of routes) {
      test(`${viewport.name}: ${heading}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loginAs(page, "nora@syncore.tech");
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
        await expectNoPageOverflow(page);

        await testInfo.attach(`${viewport.name}-${slug(path)}.png`, {
          body: await page.screenshot({ animations: "disabled", fullPage: false }),
          contentType: "image/png"
        });
      });
    }
  }
});

test.describe("role-scoped responsive navigation", () => {
  test("mobile SDR session stays inside CRM routes", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "ari@syncore.tech");

    await page.goto("/sdr/queue", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "SDR queue", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Leads$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Dev$/i })).toHaveCount(0);

    await page.goto("/automation", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "CRM workspace", level: 1 })).toBeVisible();
    await expectNoPageOverflow(page);

    await testInfo.attach("mobile-sdr-shell.png", {
      body: await page.screenshot({ animations: "disabled", fullPage: false }),
      contentType: "image/png"
    });
  });

  test("mobile lead generation session stays inside lead engine routes", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "leo@syncore.tech");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Lead command center", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /^CRM$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Dev$/i })).toHaveCount(0);

    await page.goto("/crm", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Lead command center", level: 1 })).toBeVisible();
    await expectNoPageOverflow(page);

    await testInfo.attach("mobile-leadgen-shell.png", {
      body: await page.screenshot({ animations: "disabled", fullPage: false }),
      contentType: "image/png"
    });
  });

  test("mobile manager session keeps lead generation and CRM, but not developer routes", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "mina@syncore.tech");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /^Leads$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^CRM$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Dev$/i })).toHaveCount(0);

    await page.goto("/integrations", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Lead command center", level: 1 })).toBeVisible();
    await expectNoPageOverflow(page);

    await testInfo.attach("mobile-manager-shell.png", {
      body: await page.screenshot({ animations: "disabled", fullPage: false }),
      contentType: "image/png"
    });
  });
});

test("integration center explains mock, not configured, active, and attention states", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await loginAs(page, "nora@syncore.tech");
  await page.goto("/integrations", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Integration Center", level: 1 })).toBeVisible();
  await expect(page.getByText("No live calls")).toBeVisible();
  await expect(page.getByText("Idle lane")).toBeVisible();
  await expect(page.getByText("Mock-ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Configuration gap")).toBeVisible();
  await expect(page.getByText("Not configured").first()).toBeVisible();
  await expect(page.getByText("mock").first()).toBeVisible();
  await expect(page.getByText(/Stored server-side only\./).first()).toBeVisible();
  await expectNoPageOverflow(page);

  await testInfo.attach("integration-center-desktop.png", {
    body: await page.screenshot({ animations: "disabled", fullPage: false }),
    contentType: "image/png"
  });
});

async function expectNoPageOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));

  expect(metrics.documentScrollWidth - metrics.documentClientWidth).toBeLessThanOrEqual(8);
  expect(metrics.bodyScrollWidth - metrics.documentClientWidth).toBeLessThanOrEqual(8);
}

async function loginAs(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function slug(path: string) {
  if (path === "/") return "home";
  return path.replaceAll("/", "-").replace(/^-+/, "");
}
