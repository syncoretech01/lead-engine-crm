import { expect, test } from "@playwright/test";

const routes = [
  ["/", "Lead command center"],
  ["/search-profiles", "Search profiles"],
  ["/lead-jobs", "Lead jobs"],
  ["/staging", "Lead staging"],
  ["/data-quality", "Data quality"],
  ["/enrichment", "Enrichment and scoring"],
  ["/crm/accounts", "Accounts"],
  ["/crm/contacts", "Contacts"],
  ["/crm/opportunities", "Opportunities"],
  ["/sdr/queue", "SDR queue"],
  ["/sdr/manager", "SDR manager dashboard"],
  ["/outreach/campaigns", "Outreach campaigns"],
  ["/outreach/events", "Outreach event tracking"],
  ["/integrations", "Integration Center"],
  ["/reports", "Admin reports"],
  ["/reports/compliance", "Compliance workflows"],
  ["/automation", "AI automation"],
  ["/exports", "Exports"],
  ["/compliance", "Compliance"]
] as const;

test.describe("Syncore app smoke coverage", () => {
  for (const [path, heading] of routes) {
    test(`renders ${heading}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    });
  }

  test("navigates through core modules from the shell", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.getByRole("link", { name: /AI Automation/i }).click();
    await expect(page.getByRole("heading", { name: "AI automation", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: /Reports/i }).click();
    await expect(page.getByRole("heading", { name: "Admin reports", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: /Outreach/i }).click();
    await expect(page.getByRole("heading", { name: "Outreach campaigns", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: /Integrations/i }).click();
    await expect(page.getByRole("heading", { name: "Integration Center", level: 1 })).toBeVisible();
  });

  test("scopes navigation and page access for an SDR session", async ({ page, context, baseURL }) => {
    const url = baseURL ?? "http://localhost:3001";
    await context.addCookies([
      { name: "syncore_user_id", value: "user-ari", url },
      { name: "syncore_workspace_id", value: "workspace-syncore", url }
    ]);

    await page.goto("/sdr/queue", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "SDR queue", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Search Profiles/i })).toHaveCount(0);

    await page.goto("/search-profiles", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Lead command center", level: 1 })).toBeVisible();
  });
});
