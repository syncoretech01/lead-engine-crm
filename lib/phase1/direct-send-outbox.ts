import { randomUUID } from "node:crypto";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { readState, stateSnapshotId } from "@/lib/phase1/store";
import type { AppState, DirectSendChannel, DirectSendClaim } from "@/lib/phase1/types";

// Opt-in durable outbox for live 1:1 email/SMS sends. When on, a "Sending" claim
// is written BEFORE the external provider call so a retry (same requestId) will
// not double-send, and an interrupted send leaves a visible "Sending" record.
// Default off keeps the current send-then-record behavior unchanged.
export function directSendOutboxEnabled() {
  return (process.env.SYNCORE_OUTREACH_OUTBOX ?? "").trim().toLowerCase() === "true";
}

function ensureClaims(state: AppState): DirectSendClaim[] {
  if (!Array.isArray(state.directSendClaims)) {
    state.directSendClaims = [];
  }
  return state.directSendClaims;
}

export function findDirectSendClaim(
  state: AppState,
  input: { workspaceId: string; channel: DirectSendChannel; requestId: string; contactId: string }
): DirectSendClaim | undefined {
  return ensureClaims(state).find(
    (claim) =>
      claim.workspaceId === input.workspaceId &&
      claim.channel === input.channel &&
      claim.requestId === input.requestId &&
      claim.contactId === input.contactId
  );
}

export type ClaimDirectSendsResult = {
  /** Contact ids newly claimed by this call — safe to send externally. */
  toSend: string[];
  /** Contact ids that already had a claim for this request — skip to avoid a duplicate send. */
  alreadyClaimed: string[];
};

// Claims the given contacts for a send. Contacts that already have a claim for
// this (channel, requestId) are returned as `alreadyClaimed` and must NOT be
// re-sent (at-most-once). Mutates state; call inside updateState.
export function claimDirectSends(
  state: AppState,
  input: {
    workspaceId: string;
    channel: DirectSendChannel;
    requestId: string;
    actorUserId: string;
    contactIds: string[];
    now?: string;
  }
): ClaimDirectSendsResult {
  const claims = ensureClaims(state);
  const now = input.now ?? new Date().toISOString();
  const toSend: string[] = [];
  const alreadyClaimed: string[] = [];

  for (const contactId of input.contactIds) {
    const existing = claims.find(
      (claim) =>
        claim.workspaceId === input.workspaceId &&
        claim.channel === input.channel &&
        claim.requestId === input.requestId &&
        claim.contactId === contactId
    );
    if (existing) {
      alreadyClaimed.push(contactId);
      continue;
    }
    claims.push({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      channel: input.channel,
      requestId: input.requestId,
      contactId,
      status: "Sending",
      actorUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now
    });
    toSend.push(contactId);
  }

  return { toSend, alreadyClaimed };
}

export type DirectSendOutcome = {
  contactId: string;
  status: "sent" | "failed";
  providerMessageId?: string;
  reason?: string;
};

// Finalizes claims to Sent/Failed after the external send. Mutates state; call
// inside the same updateState that records the send results.
export function finalizeDirectSendClaims(
  state: AppState,
  input: {
    workspaceId: string;
    channel: DirectSendChannel;
    requestId: string;
    outcomes: DirectSendOutcome[];
    now?: string;
  }
) {
  const claims = ensureClaims(state);
  const now = input.now ?? new Date().toISOString();

  for (const outcome of input.outcomes) {
    const claim = claims.find(
      (item) =>
        item.workspaceId === input.workspaceId &&
        item.channel === input.channel &&
        item.requestId === input.requestId &&
        item.contactId === outcome.contactId
    );
    if (!claim) {
      continue;
    }
    claim.status = outcome.status === "sent" ? "Sent" : "Failed";
    claim.providerMessageId = outcome.providerMessageId ?? claim.providerMessageId;
    claim.reason = outcome.reason ?? claim.reason;
    claim.updatedAt = now;
  }
}

// Open ("Sending") claims for a contact — a previous send that never confirmed.
// Surfaced in the UI so an SDR can verify before resending.
export function openDirectSendClaimsForContact(
  state: AppState,
  input: { workspaceId: string; contactId: string }
): DirectSendClaim[] {
  return ensureClaims(state).filter(
    (claim) =>
      claim.workspaceId === input.workspaceId &&
      claim.contactId === input.contactId &&
      claim.status === "Sending"
  );
}

// Reads open "Sending" claims for a contact directly from the snapshot (claims
// are snapshot-only, so the fast read models don't include them). Call only when
// the outbox is enabled — otherwise no claims exist and this read is skipped.
export async function readOpenDirectSendClaimsForContact(
  workspaceId: string,
  contactId: string
): Promise<DirectSendClaim[]> {
  const claims = await readDirectSendClaimsRaw();
  return claims.filter(
    (claim) =>
      claim.workspaceId === workspaceId && claim.contactId === contactId && claim.status === "Sending"
  );
}

async function readDirectSendClaimsRaw(): Promise<DirectSendClaim[]> {
  if (resolveStorageDriver() === "prisma") {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.$queryRaw<Array<{ directSendClaims: unknown }>>`
      SELECT "state"->'directSendClaims' AS "directSendClaims"
      FROM "AppStateSnapshot"
      WHERE "id" = ${stateSnapshotId}
      LIMIT 1
    `;
    const value = rows[0]?.directSendClaims;
    return Array.isArray(value) ? (value as DirectSendClaim[]) : [];
  }

  const state = await readState();
  return Array.isArray(state.directSendClaims) ? state.directSendClaims : [];
}
