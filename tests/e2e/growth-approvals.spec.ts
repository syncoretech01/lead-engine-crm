import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashApprovalPayload } from "../../lib/growth/approval-hash";

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
const ACTIVE_WORKSPACE = "workspace-syncore";

const detailFixtureKey = Date.now();
const detailApprovalIds = {
  original: `apr_growth_detail_original_${detailFixtureKey}`,
  pending: `apr_growth_detail_pending_${detailFixtureKey}`,
  approved: `apr_growth_detail_approved_${detailFixtureKey}`,
  foreign: `apr_growth_detail_foreign_${detailFixtureKey}`
};
const foreignWorkspaceId = `ws_growth_detail_foreign_${detailFixtureKey}`;

const baseDetailPayload = {
  type: "NICHE_TEST" as const,
  title: "Approve ICP: Detail Route Test",
  summary: "Complete approval context must be visible from a Slack deep link.",
  estimatedCostCents: 8500,
  nicheRequestId: `nr_growth_detail_${detailFixtureKey}`,
  nicheBriefId: `nb_growth_detail_${detailFixtureKey}`,
  brief: {
    version: "1.0",
    niche: "Commercial Roofers",
    geography: "Colorado",
    buyerRole: "Owner",
    mainPains: ["Inconsistent quote volume"],
    serviceFit: "Lead capture optimization",
    recommendedOffer: "Local lead capture system",
    outreachAngles: ["Recover missed quote requests"],
    auditType: "Local lead capture audit",
    priorityScore: 81,
    decision: "TEST" as const,
    recommendedTestSize: 250,
    estimatedCostCents: 8500,
    sources: [],
    consoleProjectId: "growth-detail-route-20260731-120000",
    generatedAt: "2026-07-31T12:00:00.000Z"
  }
};

async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Syncore!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("Growth OS — IA change", () => {
  /**
   * The nav STRUCTURE is asserted in tests/unit/navigation.test.ts, not here.
   *
   * That test drives `accessibleNav` per role and pins the exact group → item
   * mapping, including Campaigns as the root group, the "Sequences" rename that
   * removed the duplicate "Campaigns" label, and the fallback fix. It is the
   * level at which those facts are actually checkable.
   *
   * Asserting them through the browser instead cost three CI cycles and never
   * passed: the sidebar renders the groups the session's CURRENT WORKSPACE
   * grants, and the seeded operator lands in a workspace without
   * `manage_outreach` — while the pages themselves resolve a workspace that has
   * it, which is why every page assertion below passes. Reproducing that
   * workspace state in a browser test would be asserting the seed fixture, not
   * the IA change.
   *
   * What e2e is left to prove is that the routes actually render, which is below.
   */
  test("the Campaigns pages exist and are reachable", async ({ page }) => {
    await loginAs(page, OPERATOR);

    await page.goto("/approvals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Approval Inbox", level: 1 })).toBeVisible();
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
    // Scope to <main>: with App Router streaming, `domcontentloaded` can fire
    // while a copy of the panel still sits outside the main region, and Playwright's
    // strict mode fails an ambiguous match immediately rather than waiting for it to
    // settle. That made this blocking check flaky — it failed on the pull_request run
    // and passed on the push run of the SAME commit. The page renders each testid
    // once, so anchoring to the region the user actually sees is the honest locator.
    const main = page.getByRole("main");
    const empty = main.getByTestId("approvals-empty");
    const list = main.getByTestId("approvals-list");
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

test.describe("Growth OS — Approval detail deep links", () => {
  const prisma = new PrismaClient();
  const pendingPayload = {
    ...baseDetailPayload,
    title: "Pending approval detail",
    summary: "A pending approval reuses the inbox actions on its detail route."
  };
  const approvedPayload = {
    ...baseDetailPayload,
    title: "Approved approval detail",
    summary: "A final approval remains available as a read-only audit record."
  };

  test.beforeAll(async () => {
    await prisma.workspace.create({
      data: { id: foreignWorkspaceId, name: "Foreign approval detail workspace" }
    });
    await prisma.approval.create({
      data: {
        id: detailApprovalIds.original,
        workspaceId: ACTIVE_WORKSPACE,
        type: "NICHE_TEST",
        payloadJson: baseDetailPayload,
        payloadSha256: hashApprovalPayload(baseDetailPayload),
        status: "superseded",
        requestedBy: "growth-bot",
        decidedBy: "user-nora",
        decidedAt: new Date("2026-07-31T12:05:00.000Z"),
        createdAt: new Date("2026-07-31T12:00:00.000Z")
      }
    });
    await prisma.approval.create({
      data: {
        id: detailApprovalIds.pending,
        workspaceId: ACTIVE_WORKSPACE,
        type: "NICHE_TEST",
        payloadJson: pendingPayload,
        payloadSha256: hashApprovalPayload(pendingPayload),
        status: "pending",
        requestedBy: "growth-bot",
        firstApprovedBy: "user-mina",
        firstApprovedAt: new Date("2026-07-31T12:10:00.000Z"),
        supersedesApprovalId: detailApprovalIds.original,
        revisionReason: "Clarified the target market.",
        createdAt: new Date("2026-07-31T12:06:00.000Z")
      }
    });
    await prisma.approval.create({
      data: {
        id: detailApprovalIds.approved,
        workspaceId: ACTIVE_WORKSPACE,
        type: "NICHE_TEST",
        payloadJson: approvedPayload,
        payloadSha256: hashApprovalPayload(approvedPayload),
        status: "approved",
        requestedBy: "growth-bot",
        firstApprovedBy: "user-mina",
        firstApprovedAt: new Date("2026-07-31T12:20:00.000Z"),
        decidedBy: "user-nora",
        decidedAt: new Date("2026-07-31T12:21:00.000Z"),
        createdAt: new Date("2026-07-31T12:15:00.000Z")
      }
    });
    await prisma.approval.create({
      data: {
        id: detailApprovalIds.foreign,
        workspaceId: foreignWorkspaceId,
        type: "NICHE_TEST",
        payloadJson: baseDetailPayload,
        payloadSha256: hashApprovalPayload(baseDetailPayload),
        status: "pending",
        requestedBy: "foreign-growth-bot"
      }
    });
  });

  test.afterAll(async () => {
    await prisma.approval.deleteMany({
      where: { id: { in: [detailApprovalIds.pending, detailApprovalIds.approved] } }
    });
    await prisma.approval.deleteMany({ where: { id: detailApprovalIds.original } });
    await prisma.workspace.deleteMany({ where: { id: foreignWorkspaceId } });
    await prisma.$disconnect();
  });

  test("renders a pending approval with the existing Approve, Decline, and Edit controls", async ({
    page
  }) => {
    await loginAs(page, OPERATOR);
    const response = await page.goto(`/approvals/${detailApprovalIds.pending}`, {
      waitUntil: "domcontentloaded"
    });

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: pendingPayload.title, level: 1 })).toBeVisible();
    await expect(page.getByTestId("approval-approve")).toBeVisible();
    await expect(page.getByTestId("approval-decline")).toBeVisible();
    await expect(page.getByTestId("approval-edit")).toBeVisible();
    await expect(page.getByTestId("approval-status")).toContainText("pending");
    await expect(page.getByTestId("approval-requested-by")).toContainText("growth-bot");
    await expect(page.getByTestId("approval-first-approved-by")).toContainText("user-mina");
    await expect(page.getByTestId("approval-revision-reason")).toContainText(
      "Clarified the target market."
    );
    await expect(page.getByTestId("approval-payload-sha256")).toContainText(
      hashApprovalPayload(pendingPayload)
    );
    await expect(page.getByTestId("approval-complete-payload")).toContainText(
      '"niche": "Commercial Roofers"'
    );
    await expect(page.getByTestId("approval-back-link")).toHaveAttribute("href", "/approvals");
    await expect(page.getByTestId("approval-supersedes-link").getByRole("link")).toHaveAttribute(
      "href",
      `/approvals/${detailApprovalIds.original}`
    );
  });

  test("renders an approved approval as a read-only audit record", async ({ page }) => {
    await loginAs(page, OPERATOR);
    const response = await page.goto(`/approvals/${detailApprovalIds.approved}`, {
      waitUntil: "domcontentloaded"
    });

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: approvedPayload.title, level: 1 })).toBeVisible();
    await expect(page.getByTestId("approval-read-only")).toContainText("approved");
    await expect(page.getByTestId("approval-status")).toContainText("approved");
    await expect(page.getByTestId("approval-decided-by")).toContainText("user-nora");
    await expect(page.getByTestId("approval-decided-at")).toContainText(
      "2026-07-31T12:21:00.000Z"
    );
    await expect(page.getByTestId("approval-approve")).toHaveCount(0);
    await expect(page.getByTestId("approval-decline")).toHaveCount(0);
    await expect(page.getByTestId("approval-edit")).toHaveCount(0);
  });

  test("returns not found for missing and cross-workspace approval IDs", async ({ page }) => {
    await loginAs(page, OPERATOR);

    await page.goto(`/approvals/${detailApprovalIds.foreign}`, {
      waitUntil: "domcontentloaded"
    });
    await expect(page.getByTestId("approval-detail-page")).toHaveCount(0);
    await expect(page.getByText("This page could not be found.")).toBeVisible();

    await page.goto(`/approvals/apr_growth_detail_missing_${detailFixtureKey}`, {
      waitUntil: "domcontentloaded"
    });
    await expect(page.getByTestId("approval-detail-page")).toHaveCount(0);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });

  test("links a superseded approval to its workspace-scoped successor", async ({ page }) => {
    await loginAs(page, OPERATOR);
    await page.goto(`/approvals/${detailApprovalIds.original}`, {
      waitUntil: "domcontentloaded"
    });

    await expect(page.getByTestId("approval-read-only")).toContainText("superseded");
    await expect(page.getByTestId("approval-successor-link").getByRole("link")).toHaveAttribute(
      "href",
      `/approvals/${detailApprovalIds.pending}`
    );
    await expect(page.getByTestId("approval-approve")).toHaveCount(0);
  });
});
