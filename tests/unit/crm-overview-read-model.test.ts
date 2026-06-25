import { afterEach, describe, expect, it } from "vitest";
import { getDemoSession } from "@/lib/phase1/auth";
import { readFastCrmOverviewModel } from "@/lib/phase1/crm-overview-read-model";
import { createSeedState } from "@/lib/phase1/seed";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("CRM overview fast read model", () => {
  it("defers to the snapshot fallback outside Prisma storage", async () => {
    process.env.SYNCORE_STORAGE_DRIVER = "file";
    const state = createSeedState();
    const session = getDemoSession(state);

    await expect(readFastCrmOverviewModel(session, session.workspace.id)).resolves.toBeUndefined();
  });
});
