import { randomUUID } from "node:crypto";
import { ensureAiDefaults } from "@/lib/phase1/ai";
import { ensureAuthDefaults } from "@/lib/phase1/auth-service";
import { ensureComplianceDefaults } from "@/lib/phase1/compliance";
import { ensureCrmDefaults } from "@/lib/phase1/crm";
import { defaultExportRules } from "@/lib/phase1/exporting";
import { ensureJobObservabilityDefaults } from "@/lib/phase1/jobs";
import { ensureMoneyLedgerDefaults } from "@/lib/phase1/money";
import { ensureOutreachDefaults } from "@/lib/phase1/outreach";
import { createDefaultProviderConnections } from "@/lib/phase1/provider-connections";
import { ensureReportingDefaults } from "@/lib/phase1/reporting";
import { defaultSegmentRules } from "@/lib/phase1/scoring";
import { ensureSdrDefaults } from "@/lib/phase1/sdr";
import type {
  AppState,
  AuthAccount,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceRole
} from "@/lib/phase1/types";

const stateVersion = 15;

/**
 * One real account to create at go-live. The plaintext password never reaches
 * this layer: the caller hashes it (with `hashPassword`) and passes the hash,
 * so provisioning logic stays pure, testable, and free of secret material.
 */
export type ProvisionAccountInput = {
  name: string;
  email: string;
  role: WorkspaceRole;
  passwordHash: string;
  superadmin?: boolean;
};

export type ProvisionWorkspaceInput = {
  name: string;
  id?: string;
  market?: string;
  seats?: number;
};

export type CreateProvisionedStateInput = {
  workspace: ProvisionWorkspaceInput;
  accounts: ProvisionAccountInput[];
  now?: string;
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Build a production-ready AppState that contains exactly the real workspace and
 * its scoped accounts — and none of the demo CRM/lead/outreach data that
 * `createSeedState` ships. Structural defaults (provider connections, export and
 * segment rules, CRM/SDR/outreach/compliance/reporting/AI/money baselines) are
 * generated the same way the seed does, so the workspace is immediately usable.
 */
export function createProvisionedState(input: CreateProvisionedStateInput): AppState {
  const now = input.now ?? new Date().toISOString();
  const workspaceId = input.workspace.id?.trim() || `workspace-${slugify(input.workspace.name) || randomUUID()}`;

  if (input.accounts.length === 0) {
    throw new Error("At least one account is required to provision a workspace.");
  }
  if (!input.accounts.some((account) => account.role === "Admin")) {
    throw new Error("At least one account must have the Admin role so the workspace is manageable.");
  }

  const seenEmails = new Set<string>();
  for (const account of input.accounts) {
    const email = normalizeEmail(account.email);
    if (!email.includes("@")) {
      throw new Error(`Account email "${account.email}" is not a valid email address.`);
    }
    if (seenEmails.has(email)) {
      throw new Error(`Duplicate account email "${email}". Each login must be unique.`);
    }
    seenEmails.add(email);
  }

  const workspace: Workspace = {
    id: workspaceId,
    name: input.workspace.name.trim(),
    market: input.workspace.market?.trim() || "Outbound workspace",
    seats: input.workspace.seats ?? input.accounts.length,
    health: "Operational",
    createdAt: now,
    updatedAt: now
  };

  const users: User[] = [];
  const workspaceMembers: WorkspaceMember[] = [];
  const authAccounts: AuthAccount[] = [];

  for (const account of input.accounts) {
    const email = normalizeEmail(account.email);
    const userId = `user-${slugify(account.email.split("@")[0]) || randomUUID()}`;
    users.push({ id: userId, name: account.name.trim(), email, createdAt: now });
    workspaceMembers.push({ id: `member-${randomUUID()}`, workspaceId, userId, role: account.role });
    authAccounts.push({
      id: `auth-${userId}`,
      userId,
      email,
      passwordHash: account.passwordHash,
      status: "Active",
      emailVerifiedAt: now,
      passwordUpdatedAt: now,
      failedLoginCount: 0,
      mfaEnabled: false,
      superadmin: account.superadmin ?? false,
      createdAt: now,
      updatedAt: now
    });
  }

  const ownerUserId = users[input.accounts.findIndex((account) => account.role === "Admin")].id;

  const state: AppState = {
    version: stateVersion,
    workspaces: [workspace],
    users,
    workspaceMembers,
    authAccounts,
    authSessions: [],
    userInvites: [],
    passwordResetTokens: [],
    providerConnections: createDefaultProviderConnections({ workspaceId, now, actorUserId: ownerUserId }),
    providerCredentialAudits: [],
    providerEncryptedSecrets: [],
    providerJobs: [],
    providerJobRuns: [],
    providerUsageLedger: [],
    searchProfiles: [],
    leadJobs: [],
    asyncJobRuns: [],
    jobLogs: [],
    jobIdempotencyRecords: [],
    rawLeads: [],
    normalizedRecords: [],
    companies: [],
    contacts: [],
    verificationResults: [],
    dedupeMatches: [],
    exportRules: defaultExportRules(workspaceId, now),
    providerCache: [],
    enrichmentResults: [],
    segmentRules: defaultSegmentRules(workspaceId, now),
    recordSegments: [],
    leadScores: [],
    opportunities: [],
    activities: [],
    tasks: [],
    notes: [],
    callLogs: [],
    customFields: [],
    customFieldValues: [],
    sdrTeams: [],
    sdrAssignments: [],
    followUpReminders: [],
    reassignmentRules: [],
    outreachProviders: [],
    outreachCampaigns: [],
    campaignSequences: [],
    sequenceSteps: [],
    emailEvents: [],
    smsEvents: [],
    webhookEvents: [],
    trackedCalls: [],
    reportSnapshots: [],
    retentionPolicies: [],
    retentionRuns: [],
    complianceChecklistItems: [],
    dataSubjectRequests: [],
    deliverabilityAlerts: [],
    aiPersonalizations: [],
    aiReplyClassifications: [],
    aiCallSummaries: [],
    aiLeadScorePredictions: [],
    aiIcpRecommendations: [],
    aiDeliverabilityRecommendations: [],
    aiRevenueInsights: [],
    aiAutomationRuns: [],
    suppressionRecords: [],
    exports: [],
    auditLogs: [
      {
        id: `audit-${randomUUID()}`,
        workspaceId,
        actorUserId: ownerUserId,
        objectType: "workspace",
        objectId: workspaceId,
        action: "workspace_provisioned",
        reason: `Provisioned ${input.accounts.length} scoped account(s) for go-live.`,
        createdAt: now
      }
    ]
  };

  // Structural defaults only — no data-processing passes (verification, dedupe,
  // enrichment) since a freshly provisioned workspace has no records yet.
  ensureJobObservabilityDefaults(state, workspaceId);
  ensureCrmDefaults(state, workspaceId);
  ensureSdrDefaults(state, workspaceId);
  ensureOutreachDefaults(state, workspaceId);
  ensureComplianceDefaults(state, workspaceId);
  ensureReportingDefaults(state, workspaceId);
  ensureAiDefaults(state, workspaceId);
  ensureMoneyLedgerDefaults(state, workspaceId, now);
  ensureAuthDefaults(state, now);

  return state;
}
