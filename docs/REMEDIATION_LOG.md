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
