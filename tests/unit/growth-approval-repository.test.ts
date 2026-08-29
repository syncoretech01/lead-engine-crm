import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";
import * as approvalRepository from "@/lib/growth/repositories/approval-repository";
import { hashApprovalPayload } from "@/lib/growth/approval-hash";

const {
  createApproval,
  decideApproval,
  reviseApproval
} = approvalRepository;

const require = createRequire(import.meta.url);
const fixture = JSON.parse(
  readFileSync(require.resolve("@syncore/contracts/fixtures/approvals/approval-record.json"), "utf8")
) as { payload: Record<string, unknown> };

/** A NICHE_TEST payload with a chosen cost, for exercising the T2 threshold. */
const payloadCosting = (cents: number) => ({ ...fixture.payload, estimatedCostCents: cents });

type Row = Record<string, unknown> & { id: string; workspaceId: string; status: string };

/**
 * In-memory stand-in for the Prisma client. The repository takes an optional
 * client precisely so the unit lane can drive it without a database — the real
 * round-trip is the integration lane's job.
 *
 * No `$transaction` member, so the repository takes its direct path.
 */
function fakeDb(opts: { t2?: number | null } = {}) {
  const rows = new Map<string, Row>();
  const outbox = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const createRow = (data: Record<string, unknown>) => {
    seq += 1;
    const row = {
      id: `apr_${seq}`,
      decidedBy: null,
      decidedAt: null,
      expiresAt: null,
      sideEffectsAppliedAt: null,
      firstApprovedBy: null,
      firstApprovedAt: null,
      creationKey: null,
      supersedesApprovalId: null,
      revisionReason: null,
      createdAt: new Date(),
      ...data
    } as unknown as Row;
    rows.set(row.id, row);
    return row;
  };

  return {
    rows,
    workspace: {
      findUnique: async () => ({ approvalThresholdT2Cents: opts.t2 ?? null })
    },
    approval: {
      create: async ({ data }: { data: Record<string, unknown> }) => createRow(data),
      findUnique: async ({ where }: { where: { creationKey?: string } }) => {
        return [...rows.values()].find((row) => row.creationKey === where.creationKey) ?? null;
      },
      upsert: async ({
        where,
        create
      }: {
        where: { creationKey: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        return (
          [...rows.values()].find((row) => row.creationKey === where.creationKey) ?? createRow(create)
        );
      },
      findFirst: async ({
        where
      }: {
        where: { id?: string; workspaceId: string; supersedesApprovalId?: string };
      }) => {
        const row = where.id
          ? rows.get(where.id)
          : [...rows.values()].find(
              (candidate) => candidate.supersedesApprovalId === where.supersedesApprovalId
            );
        // Tenant scoping lives in the query, exactly as the repository writes it.
        return row && row.workspaceId === where.workspaceId ? row : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...(rows.get(where.id) as Row), ...data } as Row;
        rows.set(where.id, row);
        return row;
      }
    },
    notifyOutbox: {
      upsert: async ({
        where,
        create
      }: {
        where: { eventId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const row = outbox.get(where.eventId) ?? { id: `notify_${outbox.size + 1}`, ...create };
        outbox.set(where.eventId, row);
        return row;
      }
    }
  };
}

const WS = "ws_1";
const OTHER_WS = "ws_2";

process.env.SYNCORE_BOT_NOTIFY_SECRET ||= "unit-notify-secret";
process.env.SYNCORE_BOT_NOTIFY_URL ||= "https://bot.example.test/notify";

describe("approval repository — the surface is three verbs", () => {
  it("exports no fourth mutating verb", () => {
    // The absence IS the contract (v9.1 §10). An update path would let the
    // stored SHA-256 stop describing what was approved.
    const mutators = Object.entries(approvalRepository)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();

    expect(mutators).toEqual(["createApproval", "decideApproval", "reviseApproval"]);

    for (const forbidden of ["update", "patch", "edit", "setStatus", "setPayload"]) {
      expect(mutators.some((name) => name.toLowerCase().includes(forbidden.toLowerCase()))).toBe(
        false
      );
    }
  });
});

describe("createApproval", () => {
  it("stores the hash, the type from the payload, and status pending", async () => {
    const db = fakeDb();
    const row = await createApproval(
      { workspaceId: WS, payload: fixture.payload, requestedBy: "usr_1", idempotencyKey: "create-1" },
      db as never
    );

    expect(row.status).toBe("pending");
    expect(row.type).toBe("NICHE_TEST");
    expect(row.payloadSha256).toBe(hashApprovalPayload(fixture.payload));
    expect(row.requestedBy).toBe("usr_1");
    expect(row.supersedesApprovalId).toBeNull();
  });

  it("refuses a payload that does not parse", async () => {
    const db = fakeDb();
    await expect(
      createApproval(
        {
          workspaceId: WS,
          payload: { type: "NOPE" },
          requestedBy: "usr_1",
          idempotencyKey: "invalid-1"
        },
        db as never
      )
    ).rejects.toThrow();
  });
});

describe("decideApproval — single approver", () => {
  let db: ReturnType<typeof fakeDb>;
  let id: string;

  beforeEach(async () => {
    db = fakeDb({ t2: null });
    const row = await createApproval(
      { workspaceId: WS, payload: payloadCosting(100), requestedBy: "usr_1", idempotencyKey: "single-1" },
      db as never
    );
    id = row.id;
  });

  it("approves when no T2 threshold is configured", async () => {
    const result = await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "approve", actorId: "usr_2" },
      db as never
    );
    expect(result.outcome).toBe("decided");
    expect(result.outcome === "decided" && result.approval.status).toBe("approved");
    expect(result.outcome === "decided" && result.approval.decidedBy).toBe("usr_2");
    expect(result.outcome === "decided" && result.approval.decidedAt).toBeInstanceOf(Date);
  });

  it("declines immediately", async () => {
    const result = await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "decline", actorId: "usr_2" },
      db as never
    );
    expect(result.outcome === "decided" && result.approval.status).toBe("declined");
  });

  it("is idempotent — a replayed tap returns the final state", async () => {
    await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "approve", actorId: "usr_2" },
      db as never
    );
    const replay = await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "decline", actorId: "usr_3" },
      db as never
    );
    expect(replay.outcome).toBe("already_final");
    // The replay must not overturn the first decision.
    expect(replay.outcome === "already_final" && replay.approval.status).toBe("approved");
    expect(replay.outcome === "already_final" && replay.approval.decidedBy).toBe("usr_2");
  });

  it("returns not_found for another workspace's approval", async () => {
    const result = await decideApproval(
      { workspaceId: OTHER_WS, approvalId: id, decision: "approve", actorId: "usr_2" },
      db as never
    );
    expect(result.outcome).toBe("not_found");
  });
});

describe("decideApproval — two-person threshold (T2)", () => {
  const T2 = 10_000;
  let db: ReturnType<typeof fakeDb>;
  let id: string;

  beforeEach(async () => {
    db = fakeDb({ t2: T2 });
    const row = await createApproval(
      { workspaceId: WS, payload: payloadCosting(T2), requestedBy: "usr_1", idempotencyKey: "t2-1" },
      db as never
    );
    id = row.id;
  });

  it("holds at pending after the first approver, recording who", async () => {
    const first = await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "approve", actorId: "usr_2" },
      db as never
    );
    expect(first.outcome).toBe("awaiting_second_approver");
    expect(first.outcome === "awaiting_second_approver" && first.approval.status).toBe("pending");
    expect(first.outcome === "awaiting_second_approver" && first.approval.firstApprovedBy).toBe(
      "usr_2"
    );
    // Crucially, not decided: nothing downstream may treat this as approved.
    expect(first.outcome === "awaiting_second_approver" && first.approval.decidedBy).toBeNull();
  });

  it("rejects the same approver tapping twice", async () => {
    await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "approve", actorId: "usr_2" },
      db as never
    );
    const again = await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "approve", actorId: "usr_2" },
      db as never
    );
    expect(again.outcome).toBe("same_approver_twice");
    expect(again.outcome === "same_approver_twice" && again.approval.status).toBe("pending");
  });

  it("approves on a second DISTINCT approver", async () => {
    await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "approve", actorId: "usr_2" },
      db as never
    );
    const second = await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "approve", actorId: "usr_3" },
      db as never
    );
    expect(second.outcome).toBe("decided");
    expect(second.outcome === "decided" && second.approval.status).toBe("approved");
    expect(second.outcome === "decided" && second.approval.decidedBy).toBe("usr_3");
    expect(second.outcome === "decided" && second.approval.firstApprovedBy).toBe("usr_2");
  });

  it("applies below the threshold with a single approver", async () => {
    const cheap = await createApproval(
      { workspaceId: WS, payload: payloadCosting(T2 - 1), requestedBy: "usr_1", idempotencyKey: "t2-cheap" },
      db as never
    );
    const result = await decideApproval(
      { workspaceId: WS, approvalId: cheap.id, decision: "approve", actorId: "usr_2" },
      db as never
    );
    expect(result.outcome).toBe("decided");
  });

  it("declines with a single approver even above the threshold", async () => {
    // The two-person rule exists to slow spending down; declining spends nothing.
    const result = await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "decline", actorId: "usr_2" },
      db as never
    );
    expect(result.outcome).toBe("decided");
    expect(result.outcome === "decided" && result.approval.status).toBe("declined");
  });
});

describe("reviseApproval", () => {
  it("supersedes the original and creates a referencing successor", async () => {
    const db = fakeDb();
    const original = await createApproval(
      { workspaceId: WS, payload: fixture.payload, requestedBy: "usr_1", idempotencyKey: "revise-1" },
      db as never
    );
    const edited = { ...fixture.payload, title: "Approve ICP: revised scope" };

    const result = await reviseApproval(
      { workspaceId: WS, approvalId: original.id, payload: edited, actorId: "usr_2" },
      db as never
    );

    expect(result.outcome).toBe("revised");
    if (result.outcome !== "revised") return;

    expect(result.superseded.status).toBe("superseded");
    expect(result.created.status).toBe("pending");
    expect(result.created.supersedesApprovalId).toBe(original.id);
    expect(result.created.payloadSha256).toBe(hashApprovalPayload(edited));
    // A revision is a new row, never a mutated one.
    expect(result.created.id).not.toBe(original.id);
    expect(result.superseded.payloadSha256).toBe(hashApprovalPayload(fixture.payload));
  });

  it("gives identical content the identical hash", async () => {
    // The revision chain's whole job is answering "did the content change?".
    // If re-hashing identical content moved the digest, it could not.
    const db = fakeDb();
    const original = await createApproval(
      { workspaceId: WS, payload: fixture.payload, requestedBy: "usr_1", idempotencyKey: "revise-2" },
      db as never
    );
    const result = await reviseApproval(
      { workspaceId: WS, approvalId: original.id, payload: fixture.payload, actorId: "usr_2" },
      db as never
    );

    expect(result.outcome === "revised" && result.created.payloadSha256).toBe(
      original.payloadSha256
    );
  });

  it("refuses to revise an already-decided approval", async () => {
    const db = fakeDb();
    const original = await createApproval(
      { workspaceId: WS, payload: fixture.payload, requestedBy: "usr_1", idempotencyKey: "revise-3" },
      db as never
    );
    await decideApproval(
      { workspaceId: WS, approvalId: original.id, decision: "approve", actorId: "usr_2" },
      db as never
    );

    const result = await reviseApproval(
      { workspaceId: WS, approvalId: original.id, payload: fixture.payload, actorId: "usr_2" },
      db as never
    );
    expect(result.outcome).toBe("already_final");
  });

  it("does not reach across workspaces", async () => {
    const db = fakeDb();
    const original = await createApproval(
      { workspaceId: WS, payload: fixture.payload, requestedBy: "usr_1", idempotencyKey: "revise-4" },
      db as never
    );
    const result = await reviseApproval(
      { workspaceId: OTHER_WS, approvalId: original.id, payload: fixture.payload, actorId: "x" },
      db as never
    );
    expect(result.outcome).toBe("not_found");
  });

  it("chains: an approval can be revised more than once", async () => {
    const db = fakeDb();
    const v1 = await createApproval(
      { workspaceId: WS, payload: fixture.payload, requestedBy: "usr_1", idempotencyKey: "revise-chain" },
      db as never
    );
    const r1 = await reviseApproval(
      {
        workspaceId: WS,
        approvalId: v1.id,
        payload: { ...fixture.payload, title: "v2" },
        actorId: "usr_2"
      },
      db as never
    );
    expect(r1.outcome).toBe("revised");
    if (r1.outcome !== "revised") return;

    const r2 = await reviseApproval(
      {
        workspaceId: WS,
        approvalId: r1.created.id,
        payload: { ...fixture.payload, title: "v3" },
        actorId: "usr_2"
      },
      db as never
    );
    expect(r2.outcome).toBe("revised");
    if (r2.outcome !== "revised") return;

    expect(r2.created.supersedesApprovalId).toBe(r1.created.id);
    expect(r1.created.supersedesApprovalId).toBe(v1.id);
  });
});

/**
 * Expiry is the spend gate: an approval carries `expiresAt` precisely when
 * actioning a stale cost estimate would spend real money (PROVIDER_RUN,
 * ENRICHMENT_RUN, PAID_VERIFICATION under CRM-2/CRM-4). It used to be checked
 * only in the orchestrator's NICHE_TEST branch — the one type that gates no paid
 * call — so every other type was approvable indefinitely past its deadline.
 * Enforced in the repository now, so no caller can route around it (rule 5).
 */
describe("decideApproval — expiry", () => {
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60 * 60_000);

  async function seed(expiresAt: Date | undefined, key: string) {
    const db = fakeDb({ t2: null });
    const row = await createApproval(
      { workspaceId: WS, payload: payloadCosting(100), requestedBy: "usr_1", idempotencyKey: key, expiresAt },
      db as never
    );
    return { db, id: row.id };
  }

  it("refuses to approve past expiresAt, and does not decide the row", async () => {
    const { db, id } = await seed(future, "expiry-1");
    // Approve after the deadline passes — seeded in the future so creation is legal.
    const result = await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "approve", actorId: "usr_2", now: new Date(future.getTime() + 1000) },
      db as never
    );
    expect(result.outcome).toBe("expired");
    expect(result.outcome === "expired" && result.approval.status).toBe("pending");
    expect(result.outcome === "expired" && result.approval.decidedBy).toBeNull();
  });

  it("still allows declining an expired approval, so it cannot get stuck pending", async () => {
    const { db, id } = await seed(future, "expiry-2");
    const result = await decideApproval(
      { workspaceId: WS, approvalId: id, decision: "decline", actorId: "usr_2", now: new Date(future.getTime() + 1000) },
      db as never
    );
    expect(result.outcome === "decided" && result.approval.status).toBe("declined");
  });

  it("approves normally before the deadline and when no deadline is set", async () => {
    const withDeadline = await seed(future, "expiry-3");
    await expect(
      decideApproval(
        { workspaceId: WS, approvalId: withDeadline.id, decision: "approve", actorId: "usr_2" },
        withDeadline.db as never
      ).then((r) => r.outcome)
    ).resolves.toBe("decided");

    const noDeadline = await seed(undefined, "expiry-4");
    await expect(
      decideApproval(
        { workspaceId: WS, approvalId: noDeadline.id, decision: "approve", actorId: "usr_2" },
        noDeadline.db as never
      ).then((r) => r.outcome)
    ).resolves.toBe("decided");
  });

  it("refuses creation of an already-expired approval (unchanged)", async () => {
    const db = fakeDb({ t2: null });
    await expect(
      createApproval(
        {
          workspaceId: WS,
          payload: payloadCosting(100),
          requestedBy: "usr_1",
          idempotencyKey: "expiry-5",
          expiresAt: past
        },
        db as never
      )
    ).rejects.toThrow(/already expired/);
  });
});
