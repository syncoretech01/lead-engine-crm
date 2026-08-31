import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { recordSdrCallingSessionWrapup } from "@/lib/phase1/sdr-calling-session";
import { SDR_CALL_OUTCOMES, assertSdrCallOutcome, isSdrCallOutcome } from "@/lib/phase1/sdr-call-outcomes";
import type { AppState, TrackedCall } from "@/lib/phase1/types";

const startedAt = "2026-07-20T13:00:00.000Z";

/**
 * A call as the dialer leaves it: answered on the wire, disposition still the
 * neutral placeholder the placement wrote. This is the state the wrap-up
 * mapper receives, and the state the removed branch used to promote.
 */
function placedCall(workspaceId: string, sdrUserId: string, contactId: string, companyId: string): TrackedCall {
  return {
    id: "call-1",
    workspaceId,
    contactId,
    companyId,
    sdrUserId,
    direction: "Outbound",
    callStatus: "Dialed",
    disposition: "No answer",
    durationSeconds: 60,
    createdAt: "2026-07-20T13:01:00.000Z",
    phoneNumber: "+15551230000",
    recordingConsent: "Not recorded"
  };
}

const workspaceId = "workspace-1";
const sdrUserId = "user-sam";
const contactId = "contact-1";

/**
 * Wrap one call up with the given outcome and hand back the resulting record.
 *
 * Deliberately NOT createSeedState(): recordSdrCallingSessionWrapup touches
 * exactly two arrays (`sdrCallingSessions` and `trackedCalls` — grep the module),
 * so building the full seed per call was pure waste. It was also slow enough to
 * blow the 15s test timeout under parallel load once five of these ran in one
 * test — a flake that looked like an assertion failure and was not.
 */
function wrapUp(outcome: string, connected = true): TrackedCall {
  const state = {
    sdrCallingSessions: [],
    trackedCalls: [placedCall(workspaceId, sdrUserId, contactId, "company-1")]
  } as unknown as AppState;

  recordSdrCallingSessionWrapup(state, {
    id: "session-outcome-test",
    workspaceId,
    sdrUserId,
    startedAt,
    now: "2026-07-20T13:03:30.000Z",
    summary: {
      contactId,
      outcome,
      connected,
      followUp: false,
      suppressed: false,
      talkTimeSeconds: 60
    }
  } as Parameters<typeof recordSdrCallingSessionWrapup>[1]);

  return state.trackedCalls.find((item) => item.id === "call-1")!;
}

describe("SDR call outcome vocabulary", () => {
  /**
   * The dock's buttons and the canonical list must not drift.
   *
   * They were separate lists, and applyWrapupOutcomeToTrackedCall branched on
   * string literals with a final else — so a button added to the UI fell into
   * that else and got a disposition nobody chose. Read from source rather than
   * imported because the dock is a client component; the assertion is on the
   * ids, which is what actually crosses the wire.
   */
  it("matches the outcomes the Focus dock can send, exactly", () => {
    const dock = readFileSync(
      path.resolve(__dirname, "../../components/crm/cockpit/focus/focus-dock.tsx"),
      "utf8"
    );
    const block = dock.slice(dock.indexOf("const OUTCOMES: OutcomeDef[]"), dock.indexOf("const LEAD_STATUSES"));
    // Match each ENTRY, then find its id anywhere inside — not `{ id:`. The
    // brace-anchored form was bypassable by field order alone: an entry written
    // `{ status: "Working", id: "Sounded keen", … }` was invisible, so the dock
    // could grow a button that makes assertSdrCallOutcome throw and discard the
    // whole wrap-up, with CI green.
    const entries = [...block.matchAll(/\{[^{}]*\}/g)].map((match) => match[0]);
    const ids = entries
      .map((entry) => entry.match(/\bid:\s*"([^"]+)"/)?.[1])
      .filter((id): id is string => Boolean(id));

    // Every entry must yield an id, or the extraction is silently dropping one.
    expect(ids).toHaveLength(entries.length);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual([...SDR_CALL_OUTCOMES]);
  });

  it("rejects an outcome nothing can classify", () => {
    expect(() => assertSdrCallOutcome("Sounded keen")).toThrow(/Unknown call outcome/);
    expect(isSdrCallOutcome("Sounded keen")).toBe(false);
  });
});

/**
 * Nothing may invent interest the rep did not record.
 *
 * The mapper's final branch promoted the placeholder disposition to "Interested"
 * for every connected outcome it had no explicit case for — four of the eleven,
 * including "Do not contact". That fed straight into the metric managers steer
 * by, and no rep ever clicked anything saying the lead was interested.
 */
describe("wrap-up disposition never inflates", () => {
  it("does not mark a plain Connected call as Interested", () => {
    const call = wrapUp("Connected");

    expect(call.callStatus).toBe("Connected");
    expect(call.disposition).not.toBe("Interested");
  });

  it("records Do not contact as Not interested, never Interested", () => {
    expect(wrapUp("Do not contact").disposition).toBe("Not interested");
  });

  it("does not mark Follow-up required as Interested", () => {
    // Qualified is deliberately NOT in this list — see the call-wins test below.
    // An earlier version of this fix lumped the two together and recorded a
    // qualified call as unclassified, which drops a genuine win.
    expect(wrapUp("Follow-up required").disposition).not.toBe("Interested");
  });

  it("still records the outcomes that genuinely carry a disposition", () => {
    expect(wrapUp("Meeting booked").disposition).toBe("Meeting booked");
    expect(wrapUp("Not interested").disposition).toBe("Not interested");
    expect(wrapUp("Voicemail", false).disposition).toBe("Left voicemail");
    expect(wrapUp("Wrong number", false).disposition).toBe("Bad number");
    expect(wrapUp("Hang Up").disposition).toBe("Hung up");
  });

  it("says connected-unclassified explicitly rather than leaving the placeholder", () => {
    // Three of the four surfaces that render a disposition read it WITHOUT
    // consulting callStatus, so leaving the dial-time placeholder made the AI
    // summariser narrate "a no answer call lasting 7 minutes" and /outreach/events
    // badge "No answer" directly above "Connected, 7 min".
    for (const outcome of ["Connected", "Follow-up required"]) {
      expect(wrapUp(outcome).disposition, outcome).toBe("Connected");
    }
  });

  it("keeps Qualified in the call-wins metric", () => {
    // Recording a qualified call as unclassified would be a different lie in the
    // opposite direction, and drops a genuine win out of the metric at
    // app/outreach/events/page.tsx.
    expect(wrapUp("Qualified").disposition).toBe("Interested");
  });
});
