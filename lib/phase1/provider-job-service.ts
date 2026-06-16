"use server";

import { assertPermission } from "@/lib/phase1/auth";
import { providerJobWriteTables } from "@/lib/phase1/normalized-write-tables";
import {
  completeProviderJobRun,
  createProviderJob,
  failProviderJobRun,
  providerJobSnapshot,
  retryProviderJobRun,
  startProviderJobRun,
  type CompleteProviderJobRunInput,
  type CreateProviderJobInput,
  type FailProviderJobRunInput
} from "@/lib/phase1/provider-jobs";
import {
  processProviderJobQueue,
  type ProviderWorkerClaimOptions
} from "@/lib/phase1/provider-worker";
import { getSession, readState, updateState } from "@/lib/phase1/store";

export async function createProviderExecutionJob(input: CreateProviderJobInput) {
  return updateState(
    (state, session) => createProviderJob(state, session, input),
    { normalizedTables: providerJobWriteTables }
  );
}

export async function startProviderExecutionRun(runId: string) {
  return updateState(
    (state, session) => {
      assertPermission(session, "manage_workspace");
      return startProviderJobRun(state, runId, session.workspace.id);
    },
    { normalizedTables: providerJobWriteTables }
  );
}

export async function completeProviderExecutionRun(input: CompleteProviderJobRunInput) {
  return updateState(
    (state, session) => {
      assertPermission(session, "manage_workspace");
      return completeProviderJobRun(state, { ...input, workspaceId: session.workspace.id });
    },
    { normalizedTables: providerJobWriteTables }
  );
}

export async function failProviderExecutionRun(input: FailProviderJobRunInput) {
  return updateState(
    (state, session) => {
      assertPermission(session, "manage_workspace");
      return failProviderJobRun(state, { ...input, workspaceId: session.workspace.id });
    },
    { normalizedTables: providerJobWriteTables }
  );
}

export async function retryProviderExecutionJob(providerJobId: string) {
  return updateState(
    (state, session) => {
      assertPermission(session, "manage_workspace");
      return retryProviderJobRun(state, providerJobId, session.workspace.id);
    },
    { normalizedTables: providerJobWriteTables }
  );
}

export async function getProviderExecutionJobSnapshot(providerJobId: string) {
  const state = await readState();
  const session = await getSession(state);
  return providerJobSnapshot(state, session.workspace.id, providerJobId);
}

export async function processProviderExecutionQueue(input: Omit<ProviderWorkerClaimOptions, "workspaceId"> = {
  workerId: "syncore-local-worker"
}) {
  return updateState(
    (state, session) => {
      assertPermission(session, "manage_workspace");
      return processProviderJobQueue(state, {
        ...input,
        workspaceId: session.workspace.id
      });
    },
    { normalizedTables: providerJobWriteTables }
  );
}
