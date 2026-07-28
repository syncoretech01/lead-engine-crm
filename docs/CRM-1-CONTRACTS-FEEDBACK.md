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

### 1.2 `ApprovalDecide` and `ApprovalRevise` carry no `workspaceId`

**Severity: medium — a decision, not a bug.** Both shapes identify the approval by
`approvalId` alone. Every consumer of these endpoints is multi-tenant, and the CRM's repository
puts `workspaceId` in every `where` (that is what the tenant-isolation test asserts), so the
tenant has to arrive somehow.

CRM-1 passes it as an `X-Syncore-Workspace-Id` header rather than adding a field locally, because
a local addition is exactly the silent divergence this file exists to prevent. That works, but it
means tenancy is transport-level for these two calls and payload-level nowhere — and the bot has
to know that convention without the contract stating it.

**The question for contracts:** should tenancy be modelled on the payload (`workspaceId: Id` on
both shapes, matching `ApprovalRecord`, which does carry it), or explicitly documented as a
transport concern with the header named in the package? Either is fine; the current state — where
it is simply absent and each consumer improvises — is the one that produces two services
disagreeing.

**Note:** an `approvalId` is unguessable, so this is not the tenant-isolation boundary; the
server-side `workspaceId` filter is. This is about the contract being complete, not about access
control.

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

**All 11 are answered.** None is left open: where CRM-1 could not produce a payload for real, the
entry says so explicitly rather than going quiet.

### 3.1 Approval payloads (9) — `src/approvals/approval-payload.ts`

**Evidence levels**, because they are not equal and the contracts repo should be able to tell
them apart:

- **PRODUCED** — a real code path in this repo builds this payload, hashes it, and stores it.
- **EXERCISED** — constructed and round-tripped through the hash and the inbox renderer in tests,
  but nothing in CRM-1 produces it for real; its producer lands in a later phase.
- **RENDERED** — implemented in the exhaustive inbox switch and type-checked, nothing more.

CRM-1 builds the spine, so only `NICHE_TEST` reaches PRODUCED. "It type-checks and renders" is
weaker evidence than "a real stage produced it", and saying so is the point of this table.

| # | Shape / field | Line | Status | Evidence |
|---|---|---|---|---|
| 1 | `EnrichmentRunApprovalPayload.uniqueRecordCount` | 111 | **CONFIRMED — keep optional** | RENDERED |
| 2 | `PaidVerificationApprovalPayload` — count vs `contactEmailIds[]` | 121 | **CONFIRMED — keep the count, do not add ids** | RENDERED |
| 3 | `PersonalizationSamplesApprovalPayload` | 142 | **CONFIRMED as-is** | RENDERED |
| 4 | `CampaignLaunchApprovalPayload` | 156 | **CONFIRMED**, one note below | RENDERED |
| 5 | `SpendExceptionApprovalPayload` | 170 | **CONFIRMED as-is** | RENDERED |
| 6 | `ScaleApprovalPayload` | 182 | **CONFIRMED as-is** | RENDERED |
| 7 | `ReplyExceptionApprovalPayload` | 193 | **CONFIRMED**, one note below | RENDERED |
| 8 | `SuppressBulkApprovalPayload` | 204 | **CONFIRMED as-is** | EXERCISED |
| 9 | `ResumeAfterBreakerApprovalPayload` | 215 | **CONFIRMED as-is** | RENDERED |

**② `PAID_VERIFICATION` — the open question is answered: keep the count.** Two reasons found by
building it. First, the hash: a 300-element id list is part of the hashed content, so the digest
changes whenever the Hub's `unknown` set shifts between proposing and deciding — an approval would
go stale for a reason that has nothing to do with what the operator agreed to. Second, the inbox:
the detail panel renders the payload, and 300 ids is an unusable wall in both the dashboard and
Slack. The set is derivable from the stage run, and §9.7 already sends `contactEmailIds[]` to the
Hub on the authorize call, which is where it belongs. Auditability is served by the stage run,
not by inflating the approved content.

**① Same argument for `uniqueRecordCount`** — a count is the renderable, stable summary; the
record set lives on the stage run. Optional is right: the field is meaningless until dedupe has
run.

**④ `CAMPAIGN_LAUNCH.approvedCopyHash` is typed `z.string().min(1).max(128)`.** Everywhere else a
digest appears the package uses `Sha256Hex`, and v9.1 §9.8 requires this to *match* the export —
an equality check against a loosely-typed string is where a casing or prefix mismatch hides.
Suggest `Sha256Hex`. Flagged rather than assumed, because narrowing is a MAJOR bump and CRM-6
owns the producer.

**⑦ `ReplyExceptionApprovalPayload.replyClassification` is free text.** Fine for now — nothing
classifies replies until CRM-7. Worth revisiting as a closed enum then, since routing decisions
keyed off a free string are the kind of thing that quietly accumulates variants.

### 3.2 Hint types (2) — `src/request/niche-request.ts`

| # | Field | Line | Status | Evidence |
|---|---|---|---|---|
| 10 | `testSizeHint` — a count of companies | 65 | **CONFIRMED** | PRODUCED |
| 11 | `budgetHintCents` — `Cents`, never a float | 67 | **CONFIRMED** | PRODUCED |

Both are consumed as typed by `POST /api/chat/niche-request` and the integration suite.
`budgetHintCents` in particular: contracts already renamed v9.1 §6's `budgetHint` to integer minor
units, and this repo consumes that as-is. A voice note saying "about a hundred bucks" must become
`10000` upstream or fail validation — it can never be stored as prose, and the route's
`NicheRequestPayload.parse` enforces it.

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
