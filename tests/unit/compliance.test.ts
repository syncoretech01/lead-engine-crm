import { describe, expect, it } from "vitest";
import {
  completeDataSubjectRequest,
  createDataSubjectRequest,
  defaultPhysicalAddress
} from "@/lib/phase1/compliance";
import { createSequenceStep, createTrackedCall } from "@/lib/phase1/outreach";
import { createSeedState } from "@/lib/phase1/seed";

describe("compliance hardening", () => {
  it("seeds contacts, sequence steps, calls, and privacy request state with compliance fields", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const emailSteps = state.sequenceSteps.filter((step) => step.workspaceId === workspaceId && step.channel === "Email");
    const calls = state.trackedCalls.filter((call) => call.workspaceId === workspaceId);

    expect(state.version).toBe(16);
    expect(state.dataSubjectRequests).toEqual([]);
    expect(state.contacts.every((contact) => contact.lawfulBasis && contact.consentStatus && contact.consentSource)).toBe(true);
    expect(emailSteps.every((step) => step.complianceStatus === "Compliant")).toBe(true);
    expect(emailSteps.every((step) => step.bodyTemplate?.includes("{{unsubscribe_url}}"))).toBe(true);
    expect(emailSteps.every((step) => step.bodyTemplate?.includes("{{physical_address}}"))).toBe(true);
    expect(calls.every((call) => call.recordingConsent)).toBe(true);
  });

  it("enforces email footer requirements and SMS STOP language on created sequence steps", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const sequence = state.campaignSequences.find((item) => item.workspaceId === workspaceId);

    expect(sequence).toBeDefined();
    if (!sequence) return;

    const emailStep = createSequenceStep({
      workspaceId,
      sequenceId: sequence.id,
      stepNumber: 9,
      channel: "Email",
      delayDays: 1,
      subject: "Unit test",
      bodyTemplate: "Hi {{first_name}}, checking in.",
      personalizationVariables: ["first_name"],
      requiredFields: ["email"]
    });
    const smsStep = createSequenceStep({
      workspaceId,
      sequenceId: sequence.id,
      stepNumber: 10,
      channel: "SMS",
      delayDays: 2,
      smsTemplate: "Quick Syncore follow-up.",
      personalizationVariables: ["company"],
      requiredFields: ["phone"]
    });

    expect(emailStep.complianceStatus).toBe("Compliant");
    expect(emailStep.bodyTemplate).toContain("{{unsubscribe_url}}");
    expect(emailStep.physicalAddress).toBe(defaultPhysicalAddress);
    expect(smsStep.smsTemplate).toContain("STOP");
    expect(smsStep.complianceStatus).toBe("Compliant");
  });

  it("does not retain call recording media without granted recording consent", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const contact = state.contacts.find((item) => item.workspaceId === workspaceId && item.phone && !item.isSuppressed);

    expect(contact).toBeDefined();
    if (!contact) return;

    const call = createTrackedCall(state, {
      workspaceId,
      contactId: contact.id,
      sdrUserId: state.users[0].id,
      direction: "Outbound",
      callStatus: "Connected",
      disposition: "Interested",
      durationSeconds: 120,
      recordingConsent: "Denied",
      recordingConsentSource: "Prospect declined recording",
      recordingUrl: "https://recordings.syncore.local/denied.mp3",
      transcript: "This should not be retained.",
      callSummary: "Manual summary can be retained."
    });

    expect(call.recordingConsent).toBe("Denied");
    expect(call.recordingUrl).toBeUndefined();
    expect(call.recordingStoragePath).toBeUndefined();
    expect(call.transcript).toBeUndefined();
    expect(call.callSummary).toBe("Manual summary can be retained.");
  });

  it("completes deletion requests by anonymizing the contact and preserving suppression evidence", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const contact = state.contacts.find((item) => item.workspaceId === workspaceId && item.email && !item.isSuppressed);

    expect(contact).toBeDefined();
    if (!contact) return;

    const originalEmail = contact.email;
    const request = createDataSubjectRequest(state, {
      workspaceId,
      requestType: "Deletion",
      email: originalEmail,
      notes: "Unit test deletion request"
    });
    const result = completeDataSubjectRequest(state, {
      workspaceId,
      requestId: request.id,
      actorUserId: state.users[0].id,
      evidence: "Verified by unit test"
    });
    const updatedContact = state.contacts.find((item) => item.id === contact.id);

    expect(result.affectedContacts).toBe(1);
    expect(result.request.status).toBe("Completed");
    expect(updatedContact?.email).toBe("");
    expect(updatedContact?.phone).toBe("");
    expect(updatedContact?.doNotContact).toBe(true);
    expect(updatedContact?.lawfulBasis).toBe("Do not contact");
    expect(state.suppressionRecords.some((record) => record.type === "Deletion request" && record.email === originalEmail)).toBe(true);
  });
});
