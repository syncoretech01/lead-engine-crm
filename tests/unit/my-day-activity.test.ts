import { describe, expect, it } from "vitest";

import { myDayActivityPresentation, myDayActivityTimeLabel } from "@/lib/my-day-activity";

describe("My Day recent activity", () => {
  it.each([
    ["Call", "RingCentral call completed", "call", "Called"],
    ["Email", "Email sent", "email", "Emailed"],
    ["SMS", "SMS sent", "sms", "Texted"],
    ["Task", "Task created: Follow up with Oscar", "followup", "Added follow-up for"],
    ["Opportunity", "Qualified opportunity created", "opportunity", "Created opportunity for"],
    ["Note", "Note added", "note", "Added note for"]
  ] as const)("presents %s activity cleanly", (type, title, kind, verb) => {
    expect(myDayActivityPresentation({ type, title })).toEqual({ kind, verb });
  });

  it("formats compact relative times", () => {
    const now = new Date("2026-07-16T16:00:00.000Z");
    expect(myDayActivityTimeLabel("2026-07-16T15:59:45.000Z", now)).toBe("Just now");
    expect(myDayActivityTimeLabel("2026-07-16T15:42:00.000Z", now)).toBe("18m ago");
    expect(myDayActivityTimeLabel("2026-07-16T13:00:00.000Z", now)).toBe("3h ago");
    expect(myDayActivityTimeLabel("2026-07-14T16:00:00.000Z", now)).toBe("2d ago");
  });
});
