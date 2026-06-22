import { providerConnectionViewsForWorkspace } from "@/lib/phase1/provider-connections";
import { readState } from "@/lib/phase1/store";
import { getLiveProviderOperation, liveProviderExecutionEnabled } from "@/lib/providers/live-adapters";
import { ensureLiveProviderAdaptersRegistered } from "@/lib/providers/register-live-adapters";

/**
 * Print each provider connection's real state for the active database, so you
 * can answer "is this provider actually live?" without eyeballing the UI.
 *
 *   npm run providers:status                      # local file store
 *
 *   # against prod (PowerShell):
 *   $env:SYNCORE_STORAGE_DRIVER = "prisma"
 *   $env:DATABASE_URL = "<prod pooled or direct url>"
 *   npm run providers:status
 *
 * The configured / enabled / mode / adapter columns come from the DATABASE and
 * are authoritative. "live-ready" means a connection would make real calls when
 * the runtime has SYNCORE_ENABLE_LIVE_PROVIDERS=true. That flag is a runtime env
 * var, so the flag line below reflects THIS shell — not the Vercel runtime.
 */
const mark = (on: boolean) => (on ? "yes" : "no");
const col = (value: string, width: number) => value.padEnd(width);

async function main() {
  ensureLiveProviderAdaptersRegistered();
  const state = await readState();
  const flagOn = liveProviderExecutionEnabled();
  const driver = process.env.SYNCORE_STORAGE_DRIVER ?? "(unset → file locally / prisma in production)";

  console.log("Provider connection status");
  console.log(`Storage driver: ${driver}`);
  console.log(`Live flag (SYNCORE_ENABLE_LIVE_PROVIDERS, this shell): ${flagOn ? "ON" : "OFF"}`);
  console.log("  Note: the flag is a runtime env var. When checking prod, this reflects THIS shell, not Vercel.\n");

  let readyCount = 0;
  for (const workspace of state.workspaces) {
    const views = providerConnectionViewsForWorkspace(state, workspace.id);
    console.log(`Workspace: ${workspace.name} (${workspace.id})`);
    console.log(`  ${col("configured", 12)}${col("enabled", 9)}${col("mode", 7)}${col("adapter", 9)}${col("effective", 20)}provider`);
    for (const view of views) {
      const adapter = view.capabilities.some((capability) => Boolean(getLiveProviderOperation(view.providerId, capability)));
      const liveReady = view.hasSecret && view.enabled && view.executionMode === "live" && adapter;
      if (liveReady) readyCount += 1;

      let effective: string;
      if (liveReady) {
        effective = flagOn ? "LIVE" : "live-ready (flag off)";
      } else if (view.executionMode === "live" && !adapter) {
        effective = "live, no adapter";
      } else if (view.executionMode === "live" && !view.hasSecret) {
        effective = "live, no credential";
      } else if (view.executionMode === "live" && !view.enabled) {
        effective = "live, disabled";
      } else {
        effective = "mock";
      }

      console.log(
        `  ${col(mark(view.hasSecret), 12)}${col(mark(view.enabled), 9)}${col(view.executionMode, 7)}${col(mark(adapter), 9)}${col(effective, 20)}${view.providerId} (${view.displayName})`
      );
    }
    console.log("");
  }

  console.log(`${readyCount} connection(s) are live-ready (configured + enabled + live mode + adapter implemented).`);
  console.log(
    flagOn
      ? "This shell's live flag is ON, so live-ready connections would make real provider calls here."
      : "With SYNCORE_ENABLE_LIVE_PROVIDERS=true in the running environment (e.g. Vercel), the live-ready ones make real calls."
  );
}

main().catch((error) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
