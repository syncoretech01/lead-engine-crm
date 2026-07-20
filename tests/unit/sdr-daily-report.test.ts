import { describe, expect, it } from "vitest";

import {
  countMissingSdrDailyReports,
  duePakistanReportWindows,
  generateDueSdrDailyReports
} from "@/lib/phase1/sdr-daily-report";
import { createSeedState } from "@/lib/phase1/seed";

describe("4 AM Pakistan-time SDR daily reports", () => {
  it("rolls the reporting day exactly at 4:00 AM Asia/Karachi", () => {
    expect(duePakistanReportWindows("2030-01-02T22:59:59.000Z", 1)[0]).toEqual({
      reportDate: "2030-01-01",
      periodStart: "2029-12-31T23:00:00.000Z",
      periodEnd: "2030-01-01T23:00:00.000Z"
    });
    expect(duePakistanReportWindows("2030-01-02T23:00:00.000Z", 1)[0]).toEqual({
      reportDate: "2030-01-02",
      periodStart: "2030-01-01T23:00:00.000Z",
      periodEnd: "2030-01-02T23:00:00.000Z"
    });
  });

  it("saves one idempotent report per SDR with cross-channel and pipeline metrics", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const sdrUserId = state.workspaceMembers.find((member) => member.workspaceId === workspaceId && member.role === "SDR")!.userId;
    const contact = state.contacts.find((item) => item.workspaceId === workspaceId)!;
    const occurredAt = "2030-01-03T01:00:00.000Z";

    state.trackedCalls.unshift(
      {
        id: "daily-call-connected", workspaceId, sdrUserId, contactId: contact.id, companyId: contact.companyId,
        phoneNumber: contact.phone, direction: "Outbound", callStatus: "Connected", disposition: "Interested",
        durationSeconds: 90, recordingConsent: "Not recorded", createdAt: occurredAt
      },
      {
        id: "daily-call-voicemail", workspaceId, sdrUserId, contactId: contact.id, companyId: contact.companyId,
        phoneNumber: contact.phone, direction: "Outbound", callStatus: "Voicemail", disposition: "Left voicemail",
        durationSeconds: 0, recordingConsent: "Not recorded", createdAt: "2030-01-03T02:00:00.000Z"
      }
    );
    state.activities.unshift(
      activity("email", "Email", "Email sent", occurredAt),
      activity("email-reply", "Email", "Email replied", occurredAt),
      activity("sms", "SMS", "SMS sent", occurredAt),
      activity("sms-reply", "SMS", "SMS replied", occurredAt),
      { ...activity("meeting", "Call", "Call touch logged", occurredAt), metadata: { assignmentId: "a", outcome: "Meeting Booked" } },
      activity("note", "Note", "Call note", occurredAt)
    );
    state.opportunities.unshift({
      id: "daily-opp", workspaceId, companyId: contact.companyId, contactId: contact.id, name: "Daily opportunity",
      stage: "Qualified", amount: 2500, probability: 40, ownerUserId: sdrUserId, source: "Call wrap-up",
      createdAt: occurredAt, updatedAt: occurredAt
    });
    state.followUpReminders.unshift({
      id: "daily-followup", workspaceId, assignmentId: state.sdrAssignments[0].id, companyId: contact.companyId,
      contactId: contact.id, ownerUserId: sdrUserId, title: "Follow up", channel: "Call", dueAt: "2030-01-04T01:00:00.000Z",
      status: "Completed", createdAt: occurredAt, completedAt: "2030-01-03T03:00:00.000Z"
    });
    state.sdrCallingSessions.unshift({
      id: "daily-session", workspaceId, sdrUserId, status: "Completed", startedAt: occurredAt,
      endedAt: "2030-01-03T03:00:00.000Z", activeDurationSeconds: 600, totalCalls: 2, connectedCalls: 1,
      voicemailCalls: 1, unansweredCalls: 0, suppressedContacts: 0, followUpContacts: 1, totalTalkTimeSeconds: 90,
      completedContactIds: [contact.id], createdAt: occurredAt, updatedAt: "2030-01-03T03:00:00.000Z"
    });

    const options = { now: "2030-01-03T23:00:01.000Z", workspaceId, lookbackDays: 1 };
    expect(countMissingSdrDailyReports(state, options)).toBeGreaterThan(0);
    const result = generateDueSdrDailyReports(state, options);
    const report = state.sdrDailyReports.find((item) => item.sdrUserId === sdrUserId)!;

    expect(result.created).toBeGreaterThan(0);
    expect(report.reportDate).toBe("2030-01-03");
    expect(report.metrics).toMatchObject({
      dailyCallTarget: 150,
      callsTotal: 2,
      callsConnected: 1,
      callsVoicemail: 1,
      totalTalkTimeSeconds: 90,
      emailsSent: 1,
      emailReplies: 1,
      smsSent: 1,
      smsReplies: 1,
      opportunitiesCreated: 1,
      opportunityValue: 2500,
      followUpsCreated: 1,
      followUpsCompleted: 1,
      meetingsBooked: 1,
      notesAdded: 1,
      callingSessions: 1,
      activeCallingSeconds: 600
    });
    expect(generateDueSdrDailyReports(state, options).created).toBe(0);
    expect(countMissingSdrDailyReports(state, options)).toBe(0);

    function activity(id: string, type: "Email" | "SMS" | "Call" | "Note", title: string, createdAt: string) {
      return { id, workspaceId, companyId: contact.companyId, contactId: contact.id, type, title, actorUserId: sdrUserId, createdAt };
    }
  });
});
