import { describe, expect, it } from "vitest";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

describe("storage driver resolution", () => {
  it("defaults to file storage when no driver is configured", () => {
    expect(resolveStorageDriver({})).toBe("file");
  });

  it("allows explicit file storage without a database URL", () => {
    expect(resolveStorageDriver({ SYNCORE_STORAGE_DRIVER: "file" })).toBe("file");
  });

  it("blocks implicit or explicit file storage in production unless explicitly allowed", () => {
    expect(() => resolveStorageDriver({ NODE_ENV: "production" })).toThrow(/prisma is required/);
    expect(() =>
      resolveStorageDriver({ NODE_ENV: "production", SYNCORE_STORAGE_DRIVER: "file" })
    ).toThrow(/File storage is disabled/);
    expect(
      resolveStorageDriver({
        NODE_ENV: "production",
        SYNCORE_STORAGE_DRIVER: "file",
        SYNCORE_ALLOW_FILE_STORAGE_IN_PRODUCTION: "true"
      })
    ).toBe("file");
  });

  it("allows local file storage during the production build phase", () => {
    expect(
      resolveStorageDriver({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build"
      })
    ).toBe("file");
    expect(
      resolveStorageDriver({
        NODE_ENV: "production",
        npm_lifecycle_event: "build",
        SYNCORE_STORAGE_DRIVER: "file"
      })
    ).toBe("file");
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
