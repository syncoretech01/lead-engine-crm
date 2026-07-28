import { expect, test } from "@playwright/test";

/**
 * CRM-1 Approval Inbox + revision flow.
 *
 * ⚠️ THIS SPEC RUNS IN ITS OWN CI STEP, OUTSIDE `continue-on-error`.
 *
 * The legacy `Smoke tests` step carries `continue-on-error: true`, so its
 * failures are logged and ignored and a green `e2e` job does not mean the e2e
 * tests passed (CLAUDE.md § open items). New surfaces get real enforcement: if
 * anything here fails, the job fails. Do not move these into the smoke step —
 * a test that cannot fail the build is documentation, not a test.
 */

const OPERATOR = "nora@syncore.tech";

async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("Growth OS — IA change", () => {
  test("Campaigns is the nav root and Outreach is marked legacy", async ({ page }) => {
    await loginAs(page, OPERATOR);

    // Land ON a Campaigns-group route rather than clicking the workspace
    // switcher from "/". The sidebar renders the groups the CURRENT WORKSPACE
    // grants, and the landing workspace has lead-generation permissions only —
    // which is why asserting from "/" found no Campaigns group at all. Driving
    // the switcher instead was worse: that link is not reliably present from
    // "/", and the click just burned the 60s timeout.
    await page.goto("/approvals", { waitUntil: "domcontentloaded" });
    const nav = page.getByLabel("Primary navigation");

    // v9.1 §5.6: Campaigns is the nav root, above the function-oriented groups.
    await expect(nav.getByRole("link", { name: /^Campaigns$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^Approval Inbox$/i })).toBeVisible();

    // v9.1 §5.5, §26.17: nothing new references OutreachCampaign, and the label
    // says so where someone would otherwise start building.
    await expect(nav.getByText("Outreach (legacy sequences)")).toBeVisible();

    // The legacy item was renamed so it no longer collides with the Campaigns
    // root — exactly one nav link is called "Campaigns".
    await expect(nav.getByRole("link", { name: /^Campaigns$/i })).toHaveCount(1);
    await expect(nav.getByRole("link", { name: /^Sequences$/i })).toBeVisible();
  });

  test("the Campaigns page and the Lead Hub tile render", async ({ page }) => {
    await loginAs(page, OPERATOR);

    await page.goto("/campaigns", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Campaigns", level: 1 })).toBeVisible();

    await page.goto("/campaigns/lead-hub", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Lead Hub", level: 1 })).toBeVisible();
    // The boundary is the point: this repo never grows a lead-data screen.
    await expect(page.getByText(/lead-data system of record/i)).toBeVisible();
  });
});

test.describe("Growth OS — Approval Inbox", () => {
  test("renders the inbox", async ({ page }) => {
    await loginAs(page, OPERATOR);
    await page.goto("/approvals", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Approval Inbox", level: 1 })).toBeVisible();

    // A seeded workspace has no Growth OS approvals yet, so the honest state is
    // the empty one. This asserts the page renders rather than 500s — the
    // decide/revise behaviour is covered by the unit and integration lanes,
    // where it can be driven deterministically.
    const empty = page.getByTestId("approvals-empty");
    const list = page.getByTestId("approvals-list");
    await expect(empty.or(list)).toBeVisible();
  });

  test("explains that editing creates a revision", async ({ page }) => {
    // The rule this whole phase protects, stated on the surface where someone
    // would otherwise expect an in-place edit.
    await loginAs(page, OPERATOR);
    await page.goto("/approvals", { waitUntil: "domcontentloaded" });

    // Filtered to the visible one: the shared PageHeader renders its copy twice
    // (responsive variants, one hidden), so a bare getByText is a strict-mode
    // violation that reports "unexpected value hidden" rather than a missing
    // string — a confusing way to learn the text is actually present.
    await expect(
      page.getByText(/creates a revision/i).filter({ visible: true }).first()
    ).toBeVisible();
  });
});
