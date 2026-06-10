import { describe, expect, it } from "vitest";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

describe("storage driver resolution", () => {
  it("defaults to file storage when no driver is configured", () => {
    expect(resolveStorageDriver({})).toBe("file");
  });

  it("allows explicit file storage without a database URL", () => {
    expect(resolveStorageDriver({ SYNCORE_STORAGE_DRIVER: "file" })).toBe("file");
  });

  it("requires DATABASE_URL for prisma storage", () => {
    expect(() => resolveStorageDriver({ SYNCORE_STORAGE_DRIVER: "prisma" })).toThrow(/DATABASE_URL/);
  });

  it("uses prisma storage when explicitly configured with a database URL", () => {
    expect(
      resolveStorageDriver({
        SYNCORE_STORAGE_DRIVER: "prisma",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/lead_engine_crm"
      })
    ).toBe("prisma");
  });
});
