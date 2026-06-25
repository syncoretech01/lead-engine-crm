import { campaignAudience } from "@/lib/phase1/outreach-send";
import type { AppState, Priority } from "@/lib/phase1/types";

export type EngagementTier = "Replied" | "Clicked" | "Opened" | "Delivered" | "None";

type EngagementRow = {
  contactId: string;
  score: number;
  tier: EngagementTier;
  priority: Priority;
};

export function computeCampaignEngagement(
  state: AppState,
  workspaceId: string,
  campaignId: string
): EngagementRow[] {
  const campaign = state.outreachCampaigns.find((item) => item.id === campaignId && item.workspaceId === workspaceId);
  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  const emailEvents = state.emailEvents.filter(
    (event) => event.workspaceId === workspaceId && event.campaignId === campaignId
  );
  const smsEvents = state.smsEvents.filter(
    (event) => event.workspaceId === workspaceId && event.campaignId === campaignId
  );
  const excluded = new Set<string>();
  for (const event of emailEvents) {
    if (event.eventType === "Bounced" || event.eventType === "Unsubscribed" || event.eventType === "Spam complaint") {
      excluded.add(event.contactId);
    }
  }
  for (const event of smsEvents) {
    if (event.status === "Opt-out") {
      excluded.add(event.contactId);
    }
  }

  const audience = campaignAudience(state, campaign);
  const rows = audience
    .filter((contact) => !contact.isSuppressed && !excluded.has(contact.id))
    .map((contact) => {
      const contactEmailEvents = emailEvents.filter((event) => event.contactId === contact.id);
      const contactSmsEvents = smsEvents.filter((event) => event.contactId === contact.id);
      const openCount = contactEmailEvents.filter((event) => event.eventType === "Opened").length;

      if (
        contactEmailEvents.some((event) => event.eventType === "Replied") ||
        contactSmsEvents.some((event) => event.status === "Replied")
      ) {
        return row(contact.id, 100, "Replied", "P1");
      }
      if (contactEmailEvents.some((event) => event.eventType === "Clicked")) {
        return row(contact.id, 75, "Clicked", "P1");
      }
      if (openCount > 0) {
        return row(contact.id, 45 + Math.min(Math.max(0, openCount - 1), 3) * 5, "Opened", "P2");
      }
      if (
        contactEmailEvents.some((event) => event.eventType === "Delivered") ||
        contactSmsEvents.some((event) => event.status === "Delivered")
      ) {
        return row(contact.id, 15, "Delivered", "P3");
      }
      if (contactEmailEvents.some((event) => event.eventType === "Sent") || contactSmsEvents.some((event) => event.status === "Sent")) {
        return row(contact.id, 5, "None", "P4");
      }
      return row(contact.id, 0, "None", "P4");
    })
    .sort((a, b) => b.score - a.score);

  return rows;
}

export function applyCampaignEngagementScores(
  state: AppState,
  workspaceId: string,
  campaignId: string,
  now = new Date().toISOString()
): { rescored: number; orderedContactIds: string[] } {
  const rows = computeCampaignEngagement(state, workspaceId, campaignId);
  let rescored = 0;

  for (const engagement of rows) {
    const contact = state.contacts.find((item) => item.id === engagement.contactId && item.workspaceId === workspaceId);
    if (!contact || contact.isSuppressed) {
      continue;
    }
    contact.score = engagement.score;
    contact.priority = engagement.priority;
    contact.fitReason = `Engagement (${engagement.tier}) from campaign ${campaignId}`;
    contact.updatedAt = now;
    rescored += 1;
  }

  return { rescored, orderedContactIds: rows.map((item) => item.contactId) };
}

function row(contactId: string, score: number, tier: EngagementTier, priority: Priority): EngagementRow {
  return { contactId, score, tier, priority };
}
