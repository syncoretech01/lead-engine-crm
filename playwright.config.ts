import { defineConfig, devices } from "@playwright/test";

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? "3001";
const playwrightBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${playwrightPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: playwrightBaseUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npm run dev -- --port ${playwrightPort}`,
    url: playwrightBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  // Two lanes, split by DIRECTORY rather than by a phrase in a describe title.
  //
  // The old split was `--grep "Growth OS"`, which made enforcement depend on an
  // author remembering a magic string: a new spec titled anything else silently
  // landed in the advisory lane and could never fail the build. The default is now
  // the safe one — a spec added anywhere under tests/e2e is BLOCKING unless
  // somebody deliberately moves it into tests/e2e/legacy.
  projects: [
    {
      // Everything built from CRM-1 onward. Failures fail the build.
      name: "blocking",
      testDir: "./tests/e2e",
      testIgnore: "**/legacy/**",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      // The pre-CRM-1 smoke suite, unstable in CI (mobile responsive-overflow +
      // SDR-scoped routing). Advisory: CI runs it with continue-on-error.
      // Stabilising it is its own piece of work; nothing new belongs here.
      name: "legacy",
      testDir: "./tests/e2e/legacy",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
