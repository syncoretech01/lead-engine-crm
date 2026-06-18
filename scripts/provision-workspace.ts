import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "@/lib/phase1/auth-security";
import { createProvisionedState, type ProvisionAccountInput } from "@/lib/phase1/provisioning";
import { persistedStateExists, writeState } from "@/lib/phase1/store";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { WorkspaceRole } from "@/lib/phase1/types";

const validRoles: WorkspaceRole[] = ["Admin", "Manager", "SDR", "Data Operator", "Viewer", "Compliance Admin"];

// Unambiguous alphabet (no O/0/I/l/1) for temp passwords that get reset on first login.
const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=";

type RawAccount = {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  superadmin?: unknown;
  password?: unknown;
};

type RawConfig = {
  workspace?: { name?: unknown; id?: unknown; market?: unknown; seats?: unknown };
  accounts?: unknown;
};

type ResolvedAccount = ProvisionAccountInput & { plaintextPassword: string; generated: boolean };

function parseArgs(argv: string[]) {
  const args = { configPath: "", force: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") args.force = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--config") args.configPath = argv[++i] ?? "";
    else if (arg.startsWith("--config=")) args.configPath = arg.slice("--config=".length);
  }
  return args;
}

function generatePassword(length = 20) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += passwordAlphabet[randomInt(passwordAlphabet.length)];
  }
  return out;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Config field "${field}" must be a non-empty string.`);
  }
  return value;
}

function loadConfig(configPath: string): RawConfig {
  const resolved = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
  if (!existsSync(resolved)) {
    throw new Error(
      `Provisioning config not found at "${resolved}". Copy scripts/provisioning/accounts.example.json, fill in your real workspace and team, and pass --config <path> (or set SYNCORE_PROVISION_CONFIG).`
    );
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf8")) as RawConfig;
  } catch (error) {
    throw new Error(`Could not parse provisioning config "${resolved}": ${(error as Error).message}`);
  }
}

function resolveAccounts(raw: RawConfig): ResolvedAccount[] {
  if (!Array.isArray(raw.accounts) || raw.accounts.length === 0) {
    throw new Error('Config "accounts" must be a non-empty array.');
  }

  return (raw.accounts as RawAccount[]).map((account, index) => {
    const label = `accounts[${index}]`;
    const name = asString(account.name, `${label}.name`);
    const email = asString(account.email, `${label}.email`);
    const role = asString(account.role, `${label}.role`) as WorkspaceRole;
    if (!validRoles.includes(role)) {
      throw new Error(`${label}.role "${role}" is invalid. Use one of: ${validRoles.join(", ")}.`);
    }

    const hasPassword = typeof account.password === "string" && account.password.trim().length > 0;
    const plaintextPassword = hasPassword ? (account.password as string) : generatePassword();

    return {
      name,
      email,
      role,
      superadmin: account.superadmin === true,
      passwordHash: hashPassword(plaintextPassword),
      plaintextPassword,
      generated: !hasPassword
    };
  });
}

function printCredentials(workspaceName: string, accounts: ResolvedAccount[]) {
  console.log("");
  console.log("=".repeat(72));
  console.log(`  CREDENTIALS for "${workspaceName}" — shown ONCE, not stored anywhere`);
  console.log("=".repeat(72));
  for (const account of accounts) {
    const flags = [account.role, account.superadmin ? "superadmin" : "", account.generated ? "" : "(custom pw)"]
      .filter(Boolean)
      .join(", ");
    console.log("");
    console.log(`  ${account.name}  [${flags}]`);
    console.log(`    email:    ${account.email.trim().toLowerCase()}`);
    console.log(`    password: ${account.plaintextPassword}`);
  }
  console.log("");
  console.log("-".repeat(72));
  console.log("  Distribute these over a secure channel. Each user should change their");
  console.log("  password on first login (Account settings / reset-password flow).");
  console.log("-".repeat(72));
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.configPath || process.env.SYNCORE_PROVISION_CONFIG || "scripts/provisioning/accounts.json";

  const raw = loadConfig(configPath);
  const workspaceName = asString(raw.workspace?.name, "workspace.name");
  const accounts = resolveAccounts(raw);

  const state = createProvisionedState({
    workspace: {
      name: workspaceName,
      id: typeof raw.workspace?.id === "string" ? raw.workspace.id : undefined,
      market: typeof raw.workspace?.market === "string" ? raw.workspace.market : undefined,
      seats: typeof raw.workspace?.seats === "number" ? raw.workspace.seats : undefined
    },
    accounts
  });

  const driver = resolveStorageDriver();
  console.log(`Storage driver: ${driver}`);
  console.log(`Workspace: ${workspaceName} (${state.workspaces[0].id})`);
  console.log(`Accounts: ${accounts.length} — ${accounts.map((a) => `${a.email.trim().toLowerCase()} [${a.role}]`).join(", ")}`);

  if (args.dryRun) {
    console.log("\n--dry-run: built state successfully; nothing was written.");
    printCredentials(workspaceName, accounts);
    return;
  }

  const exists = await persistedStateExists();
  if (exists && !args.force) {
    throw new Error(
      `Persisted state already exists for the "${driver}" driver. Refusing to overwrite a live workspace. Re-run with --force only if you intend to replace it (e.g. a fresh database).`
    );
  }
  if (exists && args.force) {
    console.warn("\n⚠  --force: overwriting existing persisted state.");
  }

  await writeState(state);
  console.log("\n✔ Workspace provisioned and persisted.");
  printCredentials(workspaceName, accounts);
}

main()
  .catch((error) => {
    console.error(`\n✖ Provisioning failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (resolveStorageDriver() === "prisma") {
        const { prisma } = await import("@/lib/prisma");
        await prisma.$disconnect();
      }
    } catch {
      // Best-effort cleanup; never mask the original outcome.
    }
  });
