import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import type { AppState, ProviderConnection, ProviderEncryptedSecret } from "@/lib/phase1/types";
import type { ProviderId } from "@/lib/providers/types";

const algorithm = "aes-256-gcm";
const localDevelopmentKey = "syncore-local-development-credential-key";

export type StoreProviderSecretInput = {
  workspaceId: string;
  providerConnectionId: string;
  providerId: ProviderId;
  secretVersion: number;
  secretValue: string;
  actorUserId?: string;
  createdAt: string;
};

export type ProviderSecretHealth =
  | { ok: true; secret: ProviderEncryptedSecret }
  | { ok: false; reason: string };

export function storeEncryptedProviderSecret(
  state: AppState,
  input: StoreProviderSecretInput
): ProviderEncryptedSecret {
  const secretValue = input.secretValue.trim();
  if (!secretValue) {
    throw new Error("Provider credential secret value is required.");
  }

  const secretRef = createProviderSecretRef(input.workspaceId, input.providerId, input.secretVersion);
  const encrypted = encryptProviderSecret(secretValue, {
    workspaceId: input.workspaceId,
    providerId: input.providerId,
    secretVersion: input.secretVersion
  });
  const currentSecret = state.providerEncryptedSecrets.find(
    (secret) =>
      secret.workspaceId === input.workspaceId &&
      secret.providerId === input.providerId &&
      secret.providerConnectionId === input.providerConnectionId &&
      secret.secretVersion === input.secretVersion - 1
  );
  const record: ProviderEncryptedSecret = {
    id: `provider-secret-${randomUUID()}`,
    workspaceId: input.workspaceId,
    providerConnectionId: input.providerConnectionId,
    providerId: input.providerId,
    secretRef,
    secretVersion: input.secretVersion,
    storage: "Encrypted database",
    algorithm,
    keyId: credentialKeyId(),
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    checksum: encrypted.checksum,
    rotatedFromSecretRef: currentSecret?.secretRef,
    createdById: input.actorUserId,
    createdAt: input.createdAt
  };

  state.providerEncryptedSecrets.push(record);
  return record;
}

export function resolveProviderSecret(
  state: AppState,
  secretRef: string,
  options: { workspaceId: string; providerId?: ProviderId }
): string {
  const secret = state.providerEncryptedSecrets.find((item) => item.secretRef === secretRef);
  if (!secret) {
    throw new Error("Provider encrypted secret record was not found.");
  }
  if (secret.workspaceId !== options.workspaceId) {
    throw new Error("Provider secret does not belong to the active workspace.");
  }
  if (options.providerId && secret.providerId !== options.providerId) {
    throw new Error("Provider secret does not belong to the requested provider.");
  }

  return decryptProviderSecret(secret);
}

export function providerSecretHealth(state: AppState, connection: ProviderConnection): ProviderSecretHealth {
  if (connection.secretStorage === "Environment") {
    return { ok: true, secret: environmentSecretPlaceholder(connection) };
  }
  if (!connection.secretRef) {
    return { ok: false, reason: "Credential secret reference is missing." };
  }

  const secret = state.providerEncryptedSecrets.find((item) => item.secretRef === connection.secretRef);
  if (!secret) {
    return { ok: false, reason: "Encrypted credential record is missing." };
  }
  if (secret.workspaceId !== connection.workspaceId || secret.providerId !== connection.providerId) {
    return { ok: false, reason: "Encrypted credential record scope does not match this provider connection." };
  }
  if (secret.secretVersion !== connection.secretVersion) {
    return { ok: false, reason: "Encrypted credential version does not match this provider connection." };
  }

  try {
    const plaintext = decryptProviderSecret(secret);
    if (!constantTimeEqual(secret.checksum, credentialChecksum(plaintext))) {
      return { ok: false, reason: "Encrypted credential checksum validation failed." };
    }
  } catch {
    return { ok: false, reason: "Encrypted credential could not be decrypted." };
  }

  return { ok: true, secret };
}

function encryptProviderSecret(
  secretValue: string,
  aad: { workspaceId: string; providerId: ProviderId; secretVersion: number }
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, credentialEncryptionKey(), iv);
  cipher.setAAD(aadBuffer(aad));
  const ciphertext = Buffer.concat([cipher.update(secretValue, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    checksum: credentialChecksum(secretValue)
  };
}

function decryptProviderSecret(secret: ProviderEncryptedSecret) {
  if (secret.algorithm !== algorithm) {
    throw new Error(`Unsupported provider secret algorithm: ${secret.algorithm}`);
  }

  const decipher = createDecipheriv(algorithm, credentialEncryptionKey(), Buffer.from(secret.iv, "base64"));
  decipher.setAAD(aadBuffer({
    workspaceId: secret.workspaceId,
    providerId: secret.providerId,
    secretVersion: secret.secretVersion
  }));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");

  if (!constantTimeEqual(secret.checksum, credentialChecksum(plaintext))) {
    throw new Error("Provider secret checksum mismatch.");
  }

  return plaintext;
}

function credentialEncryptionKey() {
  return createHash("sha256")
    .update(process.env.SYNCORE_CREDENTIAL_ENCRYPTION_KEY ?? localDevelopmentKey)
    .digest();
}

function credentialKeyId() {
  return process.env.SYNCORE_CREDENTIAL_KEY_ID ?? "local-development-key";
}

function credentialChecksum(secretValue: string) {
  return createHmac("sha256", credentialEncryptionKey()).update(secretValue).digest("hex");
}

function aadBuffer(input: { workspaceId: string; providerId: ProviderId; secretVersion: number }) {
  return Buffer.from(`${input.workspaceId}:${input.providerId}:v${input.secretVersion}`, "utf8");
}

function createProviderSecretRef(workspaceId: string, providerId: ProviderId, secretVersion: number) {
  return `syncore-secret://${workspaceId}/${providerId}/v${secretVersion}/${randomUUID()}`;
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function environmentSecretPlaceholder(connection: ProviderConnection): ProviderEncryptedSecret {
  return {
    id: `environment-secret-${connection.id}`,
    workspaceId: connection.workspaceId,
    providerConnectionId: connection.id,
    providerId: connection.providerId,
    secretRef: `environment://${connection.workspaceId}/${connection.providerId}`,
    secretVersion: connection.secretVersion,
    storage: "Environment",
    algorithm: "environment",
    keyId: "environment",
    ciphertext: "",
    iv: "",
    authTag: "",
    checksum: "",
    createdById: connection.updatedById,
    createdAt: connection.updatedAt
  };
}
