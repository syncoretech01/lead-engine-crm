export type StorageDriver = "file" | "prisma";

type StorageDriverEnv = {
  DATABASE_URL?: string;
  SYNCORE_STORAGE_DRIVER?: string;
};

export function resolveStorageDriver(
  env: StorageDriverEnv = process.env as StorageDriverEnv
): StorageDriver {
  const requested = env.SYNCORE_STORAGE_DRIVER?.trim().toLowerCase();

  if (!requested) {
    return "file" satisfies StorageDriver;
  }

  if (requested !== "file" && requested !== "prisma") {
    throw new Error('SYNCORE_STORAGE_DRIVER must be either "file" or "prisma".');
  }

  if (requested === "prisma" && !env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when SYNCORE_STORAGE_DRIVER=prisma.");
  }

  return requested;
}
