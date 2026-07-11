import { describe, expect, it } from "vitest";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

describe("storage driver resolution", () => {
  it("defaults to prisma when no driver is configured", () => {
    expect(resolveStorageDriver({})).toBe("prisma");
  });

  it("returns prisma when explicitly configured", () => {
    expect(resolveStorageDriver({ SYNCORE_STORAGE_DRIVER: "prisma" })).toBe("prisma");
  });

  it("throws for the removed file driver", () => {
    expect(() => resolveStorageDriver({ SYNCORE_STORAGE_DRIVER: "file" })).toThrow(
      /file storage driver has been removed/i
    );
  });

  it("throws for an unknown driver", () => {
    expect(() => resolveStorageDriver({ SYNCORE_STORAGE_DRIVER: "sqlite" })).toThrow(/must be "prisma"/);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveStorageDriver({ SYNCORE_STORAGE_DRIVER: "  PRISMA  " })).toBe("prisma");
    expect(() => resolveStorageDriver({ SYNCORE_STORAGE_DRIVER: "FILE" })).toThrow(/removed/i);
  });
});
