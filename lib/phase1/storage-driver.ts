export type StorageDriver = "file" | "prisma";

type StorageDriverEnv = {
  DATABASE_URL?: string;
  NEXT_PHASE?: string;
  NODE_ENV?: string;
  SYNCORE_ALLOW_FILE_STORAGE_IN_PRODUCTION?: string;
  SYNCORE_STORAGE_DRIVER?: string;
  npm_lifecycle_event?: string;
};

export function resolveStorageDriver(
  env: StorageDriverEnv = process.env as StorageDriverEnv
): StorageDriver {
  const requested = env.SYNCORE_STORAGE_DRIVER?.trim().toLowerCase();

  const blockFileStorage = shouldBlockFileStorage(env);

  if (!requested) {
    if (
      blockFileStorage &&
      env.SYNCORE_ALLOW_FILE_STORAGE_IN_PRODUCTION?.toLowerCase() !== "true"
    ) {
      throw new Error(
        "SYNCORE_STORAGE_DRIVER=prisma is required in production unless SYNCORE_ALLOW_FILE_STORAGE_IN_PRODUCTION=true."
      );
    }

    return "file" satisfies StorageDriver;
  }

  if (requested !== "file" && requested !== "prisma") {
    throw new Error('SYNCORE_STORAGE_DRIVER must be either "file" or "prisma".');
  }

  if (requested === "prisma" && !env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when SYNCORE_STORAGE_DRIVER=prisma.");
  }

  if (
    requested === "file" &&
    blockFileStorage &&
    env.SYNCORE_ALLOW_FILE_STORAGE_IN_PRODUCTION?.toLowerCase() !== "true"
  ) {
    throw new Error("File storage is disabled in production. Use SYNCORE_STORAGE_DRIVER=prisma.");
  }

  return requested;
}

function shouldBlockFileStorage(env: StorageDriverEnv) {
  if (env.NODE_ENV !== "production") {
    return false;
  }

  return env.NEXT_PHASE !== "phase-production-build" && env.npm_lifecycle_event !== "build";
}
