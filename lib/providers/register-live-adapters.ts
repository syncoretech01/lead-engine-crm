import { apifyHarvestDiscoverContacts, apifyMapsDiscoverCompanies } from "@/lib/providers/adapters/apify";
import { apolloFindEmail } from "@/lib/providers/adapters/apollo";
import { hunterFindEmail, hunterVerifyEmail } from "@/lib/providers/adapters/hunter";
import { millionVerifierVerifyEmail } from "@/lib/providers/adapters/millionverifier";
import { registerLiveProviderAdapter } from "@/lib/providers/live-adapters";

let registered = false;

/**
 * Register the built live provider adapters (M2 data providers). Idempotent and
 * called lazily from the execution paths, so adapters are available whenever a
 * live run is attempted without relying on a global startup hook. Registration
 * is harmless on its own — an adapter only performs a network call when its
 * connection is in live mode and SYNCORE_ENABLE_LIVE_PROVIDERS is on.
 *
 * The senders (RingCentral, Amazon SES) are not registered here yet — they send
 * and need webhooks + compliance sign-off (see docs/PROVIDER_INTEGRATION_PLAN.md).
 */
export function ensureLiveProviderAdaptersRegistered(): void {
  if (registered) return;
  registered = true;
  registerLiveProviderAdapter({ id: "millionverifier", operations: { verify_email: millionVerifierVerifyEmail } });
  registerLiveProviderAdapter({ id: "hunter", operations: { find_email: hunterFindEmail, verify_email: hunterVerifyEmail } });
  registerLiveProviderAdapter({ id: "apollo", operations: { find_email: apolloFindEmail } });
  registerLiveProviderAdapter({ id: "apify_maps", operations: { discover_companies: apifyMapsDiscoverCompanies } });
  registerLiveProviderAdapter({ id: "apify_harvest", operations: { discover_contacts: apifyHarvestDiscoverContacts } });
}

/** Test-only: reset the one-time guard so a cleared registry can re-register. */
export function resetLiveProviderAdapterRegistration(): void {
  registered = false;
}
