import { afterEach, describe, expect, it } from "vitest";
import { acceptInvitePrismaFast, loginWithPasswordPrismaFast } from "@/lib/phase1/auth-fast-path";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("auth fast paths", () => {
  it("defer to snapshot auth outside Prisma storage", async () => {
    process.env.SYNCORE_STORAGE_DRIVER = "file";

    await expect(loginWithPasswordPrismaFast({ email: "nora@syncore.tech", password: "Syncore!2026" })).resolves.toBeUndefined();
    await expect(acceptInvitePrismaFast({ token: "invite-token", name: "New User", password: "Syncore!2026" })).resolves.toBeUndefined();
  });
});
