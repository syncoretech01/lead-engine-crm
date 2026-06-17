import { randomUUID } from "node:crypto";
import type {
  Activity,
  ActivityType,
  AppState,
  CallLog,
  Company,
  Contact,
  CrmTask,
  CustomField,
  CustomFieldValue,
  Opportunity,
  OpportunityStage
} from "@/lib/phase1/types";

export const opportunityStages: OpportunityStage[] = [
  "Prospecting",
  "Qualified",
  "Discovery",
  "Proposal",
  "Closed won",
  "Closed lost"
];

export const taskStatuses: CrmTask["status"][] = ["Open", "Completed", "Overdue"];
export const taskPriorities: CrmTask["priority"][] = ["Low", "Normal", "High"];
export const callOutcomes: CallLog["outcome"][] = ["Connected", "Left voicemail", "No answer", "Bad number"];

export function stageProbability(stage: OpportunityStage) {
  const probabilities: Record<OpportunityStage, number> = {
    Prospecting: 15,
    Qualified: 35,
    Discovery: 55,
    Proposal: 75,
    "Closed won": 100,
    "Closed lost": 0
  };

  return probabilities[stage];
}

export function isOpenOpportunityStage(stage: OpportunityStage) {
  return stage !== "Closed won" && stage !== "Closed lost";
}

export function ownerUserIdForName(state: AppState, owner?: string) {
  return (
    state.users.find((user) => owner && user.name.toLowerCase() === owner.toLowerCase())?.id ??
    state.users[0]?.id ??
    "user-nora"
  );
}

export function userNameForId(state: AppState, userId?: string) {
  return state.users.find((user) => user.id === userId)?.name ?? "Syncore user";
}

/**
 * Resolve the contact/company a CRM mutation should attach to, scoped to the
 * active workspace. A contact or company id from another workspace resolves to
 * undefined so cross-tenant references can never be stored. The company id
 * falls back to the resolved contact's own (same-workspace) company.
 */
export function resolveWorkspaceCrmTargets(
  state: AppState,
  workspaceId: string,
  input: { contactId?: string; companyId?: string }
): { contact?: Contact; companyId?: string } {
  const contact = input.contactId
    ? state.contacts.find((item) => item.id === input.contactId && item.workspaceId === workspaceId)
    : undefined;
  const company = input.companyId
    ? state.companies.find((item) => item.id === input.companyId && item.workspaceId === workspaceId)
    : undefined;

  return { contact, companyId: company?.id ?? contact?.companyId };
}

export function addActivity(
  state: AppState,
  input: Omit<Activity, "id" | "createdAt"> & { createdAt?: string }
) {
  const activity: Activity = {
    id: `activity-${randomUUID()}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...input
  };

  state.activities.unshift(activity);
  return activity;
}

export function defaultCustomFields(workspaceId: string, createdAt = new Date().toISOString()): CustomField[] {
  return [
    {
      id: "field-company-territory",
      workspaceId,
      objectType: "company",
      name: "Territory",
      fieldType: "select",
      options: ["Texas", "Pacific Northwest", "California", "Mountain West", "Other"],
      createdAt
    },
    {
      id: "field-company-buying-committee",
      workspaceId,
      objectType: "company",
      name: "Buying committee",
      fieldType: "text",
      createdAt
    },
    {
      id: "field-contact-channel",
      workspaceId,
      objectType: "contact",
      name: "Preferred channel",
      fieldType: "select",
      options: ["Email", "Phone", "SMS"],
      createdAt
    },
    {
      id: "field-opportunity-forecast",
      workspaceId,
      objectType: "opportunity",
      name: "Forecast category",
      fieldType: "select",
      options: ["Pipeline", "Best case", "Commit", "Closed"],
      createdAt
    }
  ];
}

export function ensureCrmDefaults(state: AppState, workspaceId: string) {
  let changed = false;
  const now = new Date().toISOString();
  const actorUserId = state.users[0]?.id ?? "user-nora";

  if (state.customFields.filter((field) => field.workspaceId === workspaceId).length === 0) {
    state.customFields.push(...defaultCustomFields(workspaceId, now));
    changed = true;
  }

  if (state.opportunities.filter((opportunity) => opportunity.workspaceId === workspaceId).length === 0) {
    state.opportunities.push(...seedOpportunities(state, workspaceId, now));
    changed = true;
  }

  if (state.tasks.filter((task) => task.workspaceId === workspaceId).length === 0) {
    state.tasks.push(...seedTasks(state, workspaceId, actorUserId, now));
    changed = true;
  }

  if (state.notes.filter((note) => note.workspaceId === workspaceId).length === 0) {
    state.notes.push(
      ...state.companies
        .filter((company) => company.workspaceId === workspaceId)
        .slice(0, 5)
        .map((company, index) => ({
          id: `note-${slug(company.id)}-${index + 1}`,
          workspaceId,
          companyId: company.id,
          contactId: primaryContactForCompany(state, company.id)?.id,
          body: noteForCompany(company),
          createdById: ownerUserIdForName(state, primaryContactForCompany(state, company.id)?.owner),
          createdAt: offsetDate(now, -(index + 3), 11),
          updatedAt: offsetDate(now, -(index + 3), 11)
        }))
    );
    changed = true;
  }

  if (state.callLogs.filter((call) => call.workspaceId === workspaceId).length === 0) {
    state.callLogs.push(...seedCallLogs(state, workspaceId, now));
    changed = true;
  }

  if (state.customFieldValues.filter((value) => value.workspaceId === workspaceId).length === 0) {
    state.customFieldValues.push(...seedCustomFieldValues(state, workspaceId, now));
    changed = true;
  }

  if (state.activities.filter((activity) => activity.workspaceId === workspaceId).length === 0) {
    state.activities.push(...seedActivities(state, workspaceId, actorUserId, now));
    changed = true;
  }

  return { changed };
}

export function latestActivityForCompany(state: AppState, companyId: string) {
  return state.activities
    .filter((activity) => activity.companyId === companyId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

export function latestActivityForContact(state: AppState, contactId: string) {
  return state.activities
    .filter((activity) => activity.contactId === contactId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

export function customFieldValuesForObject(state: AppState, objectId: string) {
  const values = state.customFieldValues.filter((value) => value.objectId === objectId);

  return new Map(values.map((value) => [value.customFieldId, value]));
}

function seedOpportunities(state: AppState, workspaceId: string, now: string): Opportunity[] {
  return state.companies
    .filter((company) => company.workspaceId === workspaceId)
    .map((company, index) => {
      const primaryContact = primaryContactForCompany(state, company.id);
      const stage = inferredStage(company, index);

      return {
        id: `opp-${slug(company.id)}`,
        workspaceId,
        companyId: company.id,
        contactId: primaryContact?.id,
        name: `${company.name} lead engine rollout`,
        stage,
        amount: amountForCompany(company, index),
        probability: stageProbability(stage),
        expectedCloseDate: isOpenOpportunityStage(stage) ? offsetDate(now, 18 + index * 8, 0).slice(0, 10) : undefined,
        ownerUserId: ownerUserIdForName(state, primaryContact?.owner),
        source: company.sourceLineage[0] ?? "Lead engine",
        createdAt: offsetDate(now, -(index + 9), 9),
        updatedAt: offsetDate(now, -(index + 1), 15)
      };
    });
}

function seedTasks(state: AppState, workspaceId: string, actorUserId: string, now: string): CrmTask[] {
  return state.contacts
    .filter((contact) => contact.workspaceId === workspaceId && !contact.isSuppressed)
    .slice(0, 9)
    .map((contact, index) => ({
      id: `task-${slug(contact.id)}`,
      workspaceId,
      companyId: contact.companyId,
      contactId: contact.id,
      title: taskTitleForContact(contact.title, contact.status),
      status: index % 5 === 0 ? "Overdue" : "Open",
      priority: contact.priority === "P1" ? "High" : contact.priority === "P2" ? "Normal" : "Low",
      dueAt: offsetDate(now, index % 5 === 0 ? -1 : index + 1, 9),
      ownerUserId: ownerUserIdForName(state, contact.owner),
      createdById: actorUserId,
      createdAt: offsetDate(now, -(index + 2), 10),
      updatedAt: offsetDate(now, -(index + 1), 10)
    }));
}

function seedCallLogs(state: AppState, workspaceId: string, now: string): CallLog[] {
  return state.contacts
    .filter((contact) => contact.workspaceId === workspaceId && contact.phone && !contact.isSuppressed)
    .slice(0, 5)
    .map((contact, index) => ({
      id: `call-${slug(contact.id)}`,
      workspaceId,
      companyId: contact.companyId,
      contactId: contact.id,
      phone: contact.phone,
      outcome: index % 3 === 0 ? "Connected" : index % 3 === 1 ? "Left voicemail" : "No answer",
      durationSeconds: index % 3 === 0 ? 420 + index * 45 : 62,
      notes: index % 3 === 0 ? "Confirmed fit and next-step timing." : "Left a concise follow-up with source context.",
      createdById: ownerUserIdForName(state, contact.owner),
      createdAt: offsetDate(now, -(index + 1), 14)
    }));
}

function seedActivities(state: AppState, workspaceId: string, actorUserId: string, now: string): Activity[] {
  const activities: Activity[] = [];

  for (const opportunity of state.opportunities.filter((item) => item.workspaceId === workspaceId)) {
    activities.push({
      id: `activity-${opportunity.id}`,
      workspaceId,
      companyId: opportunity.companyId,
      contactId: opportunity.contactId,
      opportunityId: opportunity.id,
      type: "Opportunity",
      title: `${opportunity.stage} opportunity created`,
      body: `${opportunity.name} opened at ${opportunity.probability}% probability.`,
      actorUserId: opportunity.ownerUserId,
      metadata: { stage: opportunity.stage, amount: opportunity.amount },
      createdAt: opportunity.createdAt
    });
  }

  for (const task of state.tasks.filter((item) => item.workspaceId === workspaceId)) {
    activities.push({
      id: `activity-${task.id}`,
      workspaceId,
      companyId: task.companyId,
      contactId: task.contactId,
      type: "Task",
      title: task.title,
      body: task.dueAt ? `Due ${formatDateOnly(task.dueAt)}.` : undefined,
      actorUserId: task.createdById,
      metadata: { status: task.status, priority: task.priority },
      createdAt: task.createdAt
    });
  }

  for (const note of state.notes.filter((item) => item.workspaceId === workspaceId)) {
    activities.push({
      id: `activity-${note.id}`,
      workspaceId,
      companyId: note.companyId,
      contactId: note.contactId,
      type: "Note",
      title: "Note added",
      body: note.body,
      actorUserId: note.createdById,
      createdAt: note.createdAt
    });
  }

  for (const call of state.callLogs.filter((item) => item.workspaceId === workspaceId)) {
    activities.push({
      id: `activity-${call.id}`,
      workspaceId,
      companyId: call.companyId,
      contactId: call.contactId,
      type: "Call",
      title: `${call.outcome} call logged`,
      body: call.notes,
      actorUserId: call.createdById,
      metadata: { durationSeconds: call.durationSeconds, phone: call.phone },
      createdAt: call.createdAt
    });
  }

  if (activities.length === 0) {
    activities.push({
      id: "activity-crm-seeded",
      workspaceId,
      type: "Status change" satisfies ActivityType,
      title: "Phase 4 CRM initialized",
      body: "Accounts, contacts, opportunities, tasks, notes, calls, and custom fields are available.",
      actorUserId,
      createdAt: now
    });
  }

  return activities.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function seedCustomFieldValues(state: AppState, workspaceId: string, now: string): CustomFieldValue[] {
  const values: CustomFieldValue[] = [];
  const fields = state.customFields.filter((field) => field.workspaceId === workspaceId);
  const territoryField = fields.find((field) => field.id === "field-company-territory");
  const committeeField = fields.find((field) => field.id === "field-company-buying-committee");
  const channelField = fields.find((field) => field.id === "field-contact-channel");
  const forecastField = fields.find((field) => field.id === "field-opportunity-forecast");

  for (const company of state.companies.filter((item) => item.workspaceId === workspaceId)) {
    if (territoryField) {
      values.push({
        id: `cfv-${territoryField.id}-${slug(company.id)}`,
        workspaceId,
        customFieldId: territoryField.id,
        objectId: company.id,
        value: territoryForCompany(company),
        updatedAt: now
      });
    }

    if (committeeField) {
      values.push({
        id: `cfv-${committeeField.id}-${slug(company.id)}`,
        workspaceId,
        customFieldId: committeeField.id,
        objectId: company.id,
        value: "Owner, operator, and growth lead",
        updatedAt: now
      });
    }
  }

  for (const contact of state.contacts.filter((item) => item.workspaceId === workspaceId)) {
    if (channelField) {
      values.push({
        id: `cfv-${channelField.id}-${slug(contact.id)}`,
        workspaceId,
        customFieldId: channelField.id,
        objectId: contact.id,
        value: contact.phone ? "Phone" : "Email",
        updatedAt: now
      });
    }
  }

  for (const opportunity of state.opportunities.filter((item) => item.workspaceId === workspaceId)) {
    if (forecastField) {
      values.push({
        id: `cfv-${forecastField.id}-${slug(opportunity.id)}`,
        workspaceId,
        customFieldId: forecastField.id,
        objectId: opportunity.id,
        value: forecastForStage(opportunity.stage),
        updatedAt: now
      });
    }
  }

  return values;
}

function primaryContactForCompany(state: AppState, companyId: string) {
  return state.contacts
    .filter((contact) => contact.companyId === companyId)
    .sort((a, b) => b.score - a.score)[0];
}

function inferredStage(company: Company, index: number): OpportunityStage {
  if (company.priority === "S") return "Closed lost";
  if (company.priority === "P1") return index % 3 === 0 ? "Discovery" : index % 3 === 1 ? "Qualified" : "Proposal";
  if (company.priority === "P2") return index % 2 === 0 ? "Qualified" : "Prospecting";
  if (company.priority === "P3") return "Prospecting";
  return "Prospecting";
}

function amountForCompany(company: Company, index: number) {
  const multiplier = company.priority === "P1" ? 820 : company.priority === "P2" ? 620 : 420;
  return Math.max(8000, Math.round(company.score * multiplier + index * 1750));
}

function taskTitleForContact(title: string, status: string) {
  if (status === "Needs enrichment") return "Enrich direct contact details";
  if (status === "In review") return "Review verification before outreach";
  if (title.toLowerCase().includes("founder") || title.toLowerCase().includes("owner")) {
    return "Send founder-focused source note";
  }

  return "Complete first outbound touch";
}

function noteForCompany(company: Company) {
  const source = company.sourceLineage[0] ?? "lead engine";
  const signal = company.signals?.[0] ?? company.industry;
  return `${source} identified ${signal} fit; keep source context visible in the next touch.`;
}

function territoryForCompany(company: Company) {
  if (company.state === "TX") return "Texas";
  if (company.state === "WA") return "Pacific Northwest";
  if (company.state === "CA") return "California";
  if (company.state === "CO") return "Mountain West";
  return "Other";
}

function forecastForStage(stage: OpportunityStage) {
  if (stage === "Closed won" || stage === "Closed lost") return "Closed";
  if (stage === "Proposal") return "Commit";
  if (stage === "Discovery" || stage === "Qualified") return "Best case";
  return "Pipeline";
}

function formatDateOnly(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function offsetDate(base: string, days: number, hour: number) {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
