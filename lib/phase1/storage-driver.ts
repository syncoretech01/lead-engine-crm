// Prisma is the only storage backend. The file storage driver was removed as part
// of the AppStateSnapshot blob migration (the blob was also the file driver's whole
// store, so it had to go before the blob could be peeled). resolveStorageDriver
// still exists so the many `resolveStorageDriver() === "prisma"` guards keep
// compiling and so a stale SYNCORE_STORAGE_DRIVER=file config fails loudly instead
// of silently falling back.
export type StorageDriver = "prisma";

type StorageDriverEnv = {
  SYNCORE_STORAGE_DRIVER?: string;
};

export function resolveStorageDriver(
  env: StorageDriverEnv = process.env as StorageDriverEnv
): StorageDriver {
  const requested = env.SYNCORE_STORAGE_DRIVER?.trim().toLowerCase();

  if (requested === "file") {
    throw new Error(
      "The file storage driver has been removed. Set SYNCORE_STORAGE_DRIVER=prisma (with DATABASE_URL)."
    );
  }

  if (requested && requested !== "prisma") {
    throw new Error('SYNCORE_STORAGE_DRIVER must be "prisma".');
  }

  return "prisma";
}
