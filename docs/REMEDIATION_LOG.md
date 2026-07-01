# Remediation Log

Running log for the work order in `REMEDIATION_PLAN.md`. One entry per task, appended as work lands. Format defined in Appendix B of the plan.

---

## P0.2 — Legacy demo-session backdoor
STATUS: done
VERIFIED: `lib/phase1/store.ts` `allowLegacyDemoSession()` was gated only by `SYNCORE_ALLOW_DEMO_SESSION === "true"` with no `NODE_ENV` check. When true, `readSessionSelection` (store.ts:376-397) accepts unsigned `syncore_user_id`/`syncore_workspace_id` cookies **and** `SYNCORE_SESSION_USER_ID`/`SYNCORE_SESSION_WORKSPACE_ID` env vars, which flow into `resolveSession` (auth.ts) and grant full role permissions with no password/signature. Only operational discipline (leave flag unset) protected prod.
FLAG: n/a — hardened to fail closed (production is force-off regardless of the env flag).
FILES: `lib/phase1/store.ts` (made `allowLegacyDemoSession(env)` exported, env-injectable, returns `false` when `NODE_ENV === "production"`). Both call sites (cookie path + env-var fallback) route through this function, so both backdoors are closed by one change.
TESTS: `tests/unit/demo-session-guard.test.ts` — prod+flag=true → false (fails before fix); dev+flag=true → true; dev/test + unset → false.
FOLLOW-UP: none. Docs already instruct leaving the flag unset in prod (M0_GO_LIVE.md, ROADMAP.md); behavior is now enforced in code, so those remain accurate but no longer load-bearing.

---

## P0.1 / P0.3 — Unsubscribe secret fail-closed + centralized required-secret policy
STATUS: done
VERIFIED: `lib/phase1/unsubscribe-token.ts` `secret()` returned `env.SYNCORE_UNSUBSCRIBE_SECRET?.trim() || "syncore-dev-unsubscribe-secret-change-me"` unconditionally — no `NODE_ENV` guard. If the env var were unset in prod, unsubscribe tokens (short + long) are HMAC'd with a public constant, so anyone could forge `signShortUnsubscribeToken(contactId)` and mass-suppress arbitrary contacts. Contrast the three secrets that DID fail closed (`SYNCORE_AUTH_SECRET` in auth-security.ts, `SYNCORE_CREDENTIAL_ENCRYPTION_KEY` in provider-secret-vault.ts, `SYNCORE_WEBHOOK_SECRET` in webhooks.ts) — each had a copy-pasted prod guard, which is exactly the drift that let unsubscribe slip. P0.3 audit: the unsubscribe secret was the ONLY prod-path secret with a silent default. Provider API keys (OpenAI/RingCentral/SES) intentionally fail *open* to gate optional live features — left unchanged. `SYNCORE_CREDENTIAL_KEY_ID`'s `?? "local-development-key"` is a non-secret label — left unchanged.
FLAG: n/a — this is a fail-closed guard, not a behavioral toggle. Requires `SYNCORE_UNSUBSCRIBE_SECRET` to be set in the prod deploy env before shipping (it surfaces misconfig loudly by design). Build phase (`next build`) and dev keep the labeled default.
FILES: new `lib/phase1/require-secret.ts` (`requireSecret(name, devDefault, env)` + `isProductionBuildPhase(env)`, the single fail-closed policy). Routed all four secrets through it: unsubscribe-token.ts (the fix), auth-security.ts, provider-secret-vault.ts, webhooks.ts (dedup, behavior-preserving). `isProductionBuildPhase` moved to require-secret.ts and re-exported from auth-security.ts so existing importers (store.ts, webhooks.ts, provider-secret-vault.ts) are unchanged.
TESTS: new `tests/unit/require-secret.test.ts` (helper: configured/trim, dev default, prod-throws, prod-configured, build-phase). Extended `tests/unit/production-secrets.test.ts` with an "unsubscribe secret" block: prod-missing throws (fails before fix), prod-configured round-trips, dev/build-phase allowed, cross-secret token rejected. Existing production-secrets/production-auth/webhooks/unsubscribe-token tests still green (routing was behavior-preserving). Full suite: 64 files / 287 tests green; lint clean; tsc --noEmit clean.
FOLLOW-UP: none. Added `SYNCORE_UNSUBSCRIBE_SECRET` to the go-live env table + a "required prod secrets that fail closed" note in docs/M0_GO_LIVE.md (P0.3 doc acceptance). `.env.example` already listed it.

---

## P1.1 — Add lint + build gates to CI
STATUS: done
VERIFIED: `.github/workflows/ci.yml` had one `validate` job running 5 steps (prisma validate/generate, typecheck, unit tests). No `npm run lint`, no `next build`. Both scripts exist in package.json but were never invoked. Confirmed lint is green (`eslint .` exit 0) and `next build` is green locally (exit 0, all routes dynamic) before adding the gates.
FLAG: n/a (CI config).
FILES: `.github/workflows/ci.yml` — added a `Lint` step to the `validate` job and a new `build` job (`next build`). Build job sets a parse-only `DATABASE_URL` (Prisma client construction is lazy; build phase is detected so fail-closed secret guards use dev defaults — no live DB needed for build). Dropped the unused job-level `DATABASE_URL` from `validate` (it pointed at a non-existent DB and the DB-free unit lane never used it).
TESTS: existing gates cover this (lint + build now run in CI). Verified locally: `next build` exit 0, `eslint .` clean, `tsc --noEmit` clean.
FOLLOW-UP: none. `next build` is higher-value than typecheck alone — it catches App Router/RSC boundary errors tsc misses.
