import { apifyHarvestDiscoverContacts, apifyMapsDiscoverCompanies } from "@/lib/providers/adapters/apify";
import { apolloFindEmail } from "@/lib/providers/adapters/apollo";
import { hunterFindEmail, hunterVerifyEmail } from "@/lib/providers/adapters/hunter";
import { millionVerifierVerifyEmail } from "@/lib/providers/adapters/millionverifier";
import type { ProviderId, ProviderRequestContext, ProviderResult } from "@/lib/providers/types";

/**
 * One-off live-adapter validation. Calls a real provider adapter with a real
 * key and prints the raw + normalized result, so you can confirm each adapter's
 * request/response mapping before flipping it live in the app. This makes a real
 * network call (the point of validation); it stores nothing and touches no state.
 *
 *   npm run validate-adapter -- --provider millionverifier --email someone@acme.com
 *   npm run validate-adapter -- --provider hunter --name "Jane Doe" --domain acme.com
 *   npm run validate-adapter -- --provider hunter --op verify_email --email jane@acme.com
 *   npm run validate-adapter -- --provider apollo --name "Sam Ray" --domain acme.com --company Acme
 *   npm run validate-adapter -- --provider apify_maps --query "auto repair" --geo "Dallas, TX" --limit 5
 *   npm run validate-adapter -- --provider apify_harvest --titles "VP Sales,Founder" --geo "United States"
 *
 * Key resolution: --key <KEY>, else the provider's env var (MILLIONVERIFIER_API_KEY,
 * HUNTER_API_KEY, APOLLO_API_KEY, APIFY_TOKEN). Prefer the env var to keep the key
 * out of shell history.
 */
const keyEnvByProvider: Record<string, string> = {
  millionverifier: "MILLIONVERIFIER_API_KEY",
  hunter: "HUNTER_API_KEY",
  apollo: "APOLLO_API_KEY",
  apify_maps: "APIFY_TOKEN",
  apify_harvest: "APIFY_TOKEN"
};

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
      args[key] = value;
    }
  }
  return args;
}

async function callAdapter(
  provider: string,
  op: string,
  args: Record<string, string>,
  context: ProviderRequestContext
): Promise<ProviderResult<unknown>> {
  const name = args.name ?? "";
  const domain = args.domain ?? "";
  const company = args.company ?? "";
  const email = args.email ?? "";
  const query = args.query ?? "";
  const geographies = args.geo ? [args.geo] : undefined;
  const titles = args.titles ? args.titles.split(",").map((value) => value.trim()) : undefined;
  const limit = args.limit ? Number(args.limit) : undefined;

  switch (provider) {
    case "millionverifier":
      return millionVerifierVerifyEmail({ email }, context);
    case "hunter":
      return op === "verify_email"
        ? hunterVerifyEmail({ email }, context)
        : hunterFindEmail({ fullName: name, domain, companyName: company }, context);
    case "apollo":
      return apolloFindEmail({ fullName: name, domain, companyName: company }, context);
    case "apify_maps":
      return apifyMapsDiscoverCompanies({ query, geographies, limit }, context);
    case "apify_harvest":
      return apifyHarvestDiscoverContacts({ query, titles, geographies, limit }, context);
    default:
      throw new Error(`Unknown provider "${provider}". Use one of: ${Object.keys(keyEnvByProvider).join(", ")}.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = args.provider;
  if (!provider || !(provider in keyEnvByProvider)) {
    throw new Error(`--provider is required. One of: ${Object.keys(keyEnvByProvider).join(", ")}.`);
  }
  const op = args.op ?? (provider === "apify_maps" ? "discover_companies" : provider === "apify_harvest" ? "discover_contacts" : provider === "millionverifier" ? "verify_email" : "find_email");
  const key = args.key ?? process.env[keyEnvByProvider[provider]];
  if (!key) {
    throw new Error(`No key. Pass --key <KEY> or set ${keyEnvByProvider[provider]} in your environment.`);
  }

  const context: ProviderRequestContext = {
    workspaceId: "adapter-validation",
    providerId: provider as ProviderId,
    executionMode: "live",
    requestId: `validate-${provider}-${op}`,
    credential: { source: "vault", secret: key }
  };

  console.log(`Calling ${provider}.${op} with a real key…`);
  const result = await callAdapter(provider, op, args, context);
  console.log("\n=== status ===", result.status);
  if (result.errorMessage) console.log("error:", result.errorMessage);
  console.log(`data rows: ${result.data.length}`);
  console.log("\n=== first mapped result ===");
  console.log(JSON.stringify(result.data[0] ?? null, null, 2));
  console.log("\n(Confirm the fields look right. If a provider's shape differs, the adapter mapping needs a tweak.)");
}

main().catch((error) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
