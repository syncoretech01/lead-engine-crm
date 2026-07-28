# CRM-1 → `syncore-contracts` feedback

**Consuming repo:** `lead-engine-crm` · **Contracts version under test:** `0.2.0` · **Phase:** CRM-1

This file is CRM-1's half of the contracts confirmation duty. `@syncore/contracts` 0.2.0 marks
shapes `INFERRED (CRM-1)` — named by v9.1 but never specified — and names this repo as the one
that finds out what they actually need. Each is recorded below as **CONFIRMED** (implemented
as-is, no change needed) or with the **exact correction** required.

It goes back to the contracts repo for a patch release **before** the joint bot integration test.

**The rule this file exists to serve:** never silently diverge from a contracts shape. If one is
wrong, the fix lands in `syncore-contracts` first and this repo consumes the bump. A local
redeclaration is the failure mode — it is invisible until two services disagree in production.

---

## 1. Defects — require a patch release

### 1.1 🔴 `fixtures/approvals/approval-record.json` carries a placeholder hash

**Severity: high.** The fixture claims:

```json
"payloadSha256": "b1946ac92492d2347c6235b4d2611184b1946ac92492d2347c6235b4d2611184"
```

That is 32 hex characters repeated twice — `b1946ac92492d2347c6235b4d2611184` is the MD5 of
`"hello\n"`. It is not a SHA-256 of anything, and it is not the hash of the payload it sits next to.

**The correct value**, computed from the fixture's own `payload` using the canonicalization the
README specifies (`JSON.stringify(value, null, 2)` + trailing newline, UTF-8, SHA-256, lowercase hex):

```
fa965db8128f718235afef87fc7d2ffcfddaa4e833e1af3cccb87a1f2c1dbd13
```

**Why it matters.** README § Approvals says the hashing rule is "documented, fixture-tested, and
implemented by each consumer". The fixture is the only cross-repo anchor for that rule — it is how
the CRM and the bot discover they disagree *before* a signed approval fails verification in
production. A placeholder means the anchor holds nothing: every consumer can implement
canonicalization differently and still pass.

**Requested change:** replace the value, regenerate `MANIFEST.sha256`, patch release. Consider a
contracts-side test asserting `sha256(canonical(record.payload)) === record.payloadSha256` so the
fixture cannot drift from its own payload again.

**What CRM-1 did meanwhile** (decision recorded, not a silent divergence): the CRM's hash-stability
test pins the computed value above, so this repo's canonicalization is locked to exact bytes today.
The value's authority is this repo's until contracts adopts it. On the bump, the test should switch
to reading `payloadSha256` from the fixture rather than hard-coding it.

---

## 2. Observations — no schema change, but the README should say so

### 2.1 The canonical hash is only deterministic through `.parse()`

Measured against 0.2.0, hashing a **parsed** payload is key-order independent; hashing a **raw**
object is not:

| Input | Key order normalised? | Hashes equal? |
|---|---|---|
| `ApprovalPayload.parse(x)` vs `.parse(shuffled x)` — top level | yes | **yes** |
| `.parse(x)` vs `.parse(nested-shuffled x)` | yes | **yes** |
| raw `x` vs raw nested-shuffled `x` — no parse | no | **no** |

zod rebuilds objects in schema-declaration order, so `.parse()` is itself the canonicalizer for key
order; `JSON.stringify(…, null, 2)` then only fixes whitespace. Because both repos share the same
schema, both produce the same ordering — but **only if both parse first**.

This is load-bearing and unstated. A consumer that hashes an incoming request body directly (the
obvious implementation) gets a hash that depends on the sender's key order, and the failure is
intermittent and effectively undebuggable.

**Requested change:** README § Approvals should state the rule as *parse, then canonicalize, then
hash* — and say why. CRM-1 implements it that way.

### 2.2 `.readonly()` freezes only the top level

`ApprovalPayload.parse()` returns a frozen top-level object, but nested objects are not frozen:

```js
Object.isFrozen(parsed)        // true
Object.isFrozen(parsed.brief)  // false
parsed.brief.niche = "x"       // silently succeeds
```

README § Approvals says "mutating it throws `TypeError` in strict mode" without qualification,
which overstates the protection for exactly the nested content — the brief document — that matters
most.

**Requested change:** either document the shallowness, or deep-freeze in a `.transform()`. Not a
blocker for CRM-1; recorded so nobody relies on a guarantee that is not there.

### 2.3 Bookkeeping: CHANGELOG says "Eight" INFERRED shapes

`CHANGELOG.md:60` says *"Eight, all C2 shapes awaiting their first implementation"*. Counting
`INFERRED` markers in `src/`: 9 in `approvals/approval-payload.ts` and 2 in
`request/niche-request.ts` are attributed to **CRM-1** alone, with further RC1/RC2 items in
`research/` and `primitives.ts`. The counts may use different units (shapes vs. markers) — worth a
reconcile so the open-items list is trustworthy.

---

## 3. CRM-1 confirmation duties — 11 items

Status filled in as each gate's payload is implemented. `PENDING` means not yet reached in the
phase, **not** "no comment".

### 3.1 Approval payloads (9) — `src/approvals/approval-payload.ts`

| # | Shape / field | Line | Status |
|---|---|---|---|
| 1 | `EnrichmentRunApprovalPayload.uniqueRecordCount` | 111 | PENDING |
| 2 | `PaidVerificationApprovalPayload` — count vs `contactEmailIds[]` | 121 | PENDING |
| 3 | `PersonalizationSamplesApprovalPayload` | 142 | PENDING |
| 4 | `CampaignLaunchApprovalPayload` | 156 | PENDING |
| 5 | `SpendExceptionApprovalPayload` | 170 | PENDING |
| 6 | `ScaleApprovalPayload` | 182 | PENDING |
| 7 | `ReplyExceptionApprovalPayload` | 193 | PENDING |
| 8 | `SuppressBulkApprovalPayload` | 204 | PENDING |
| 9 | `ResumeAfterBreakerApprovalPayload` | 215 | PENDING |

> Note on scope honesty: CRM-1 builds the **spine** — the approval machinery, the inbox, the
> revision flow. Only `NICHE_TEST` has a real producer in this phase; the gates that fire in CRM-4
> through CRM-8 are exercised here as payload shapes and inbox rendering, not end to end. Items
> confirmed on that basis will say so, because "the type-checks and renders" is weaker evidence
> than "a real stage produced it" and the contracts repo should be able to tell the two apart.

### 3.2 Hint types (2) — `src/request/niche-request.ts`

| # | Field | Line | Status |
|---|---|---|---|
| 10 | `testSizeHint` — a count of companies | 65 | PENDING |
| 11 | `budgetHint` — `Cents`, never a float | 67 | PENDING |

---

## 4. Shapes consumed unchanged

Recorded so the contracts repo knows what is load-bearing in this consumer:

`ApprovalType` (11) · `ApprovalStatus` (4) · `StageType` (18) · `ApprovalPayload` union ·
`ApprovalRecord` · `ApprovalDecide` · `ApprovalRevise` · `ApprovalDecisionResult` ·
`ProviderRunProposal` · `ProviderRunDecision` · `NotifyEnvelope` / `NotifyKind` ·
`webhookEnvelope` + the four header constants + `WEBHOOK_REPLAY_WINDOW_SECONDS` ·
`NicheRequest*` · `NicheBrief*` · `Id` / `Cents` / `IsoDateTime` / `Sha256Hex`.

**Not consumed in CRM-1:** `VerificationStatus` — deliberately, see `CLAUDE.md` § open item (C).
`VerificationResult` is blob-projected (`persistence-projection.ts:210`), so the swap belongs to
CRM-3 with all six vocabulary sites changed together.
