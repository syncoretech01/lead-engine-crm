import { describe, expect, it } from "vitest";
import { timelineActivityDisplayForViewer } from "@/lib/phase1/activity-timeline-redaction";

describe("activity timeline redaction", () => {
  it("keeps assignment logic visible for managers", () => {
    const display = timelineActivityDisplayForViewer({
      activity: {
        type: "Status change",
        title: "Assigned to Zainab",
        body: "Round robin: Broker list even split between Zack and Zainab."
      },
      actorName: "Syncore Tech",
      viewerRole: "Manager",
      viewerName: "Zack Austin"
    });

    expect(display).toEqual({
      hidden: false,
      title: "Assigned to Zainab",
      body: "Round robin: Broker list even split between Zack and Zainab.",
      actor: "Syncore Tech"
    });
  });

  it("hides assignment events targeted at another SDR", () => {
    const display = timelineActivityDisplayForViewer({
      activity: {
        type: "Status change",
        title: "Assigned to Zainab",
        body: "Round robin: Broker list even split between Zack and Zainab."
      },
      actorName: "Syncore Tech",
      viewerRole: "SDR",
      viewerName: "Zack Austin"
    });

    expect(display).toEqual({ hidden: true });
  });

  it("shows reassignment to the current SDR as a plain manager assignment", () => {
    const display = timelineActivityDisplayForViewer({
      activity: {
        type: "Status change",
        title: "Reassigned to Zack Austin",
        body: "Account ownership cleanup: keep all contacts at H & S LOGISTICS LLC with Zack."
      },
      actorName: "Syncore Tech",
      viewerRole: "SDR",
      viewerName: "Zack Austin"
    });

    expect(display).toEqual({
      hidden: false,
      title: "Assigned to Zack Austin",
      actor: "Manager"
    });
  });

  it("leaves non-assignment SDR timeline events unchanged", () => {
    const display = timelineActivityDisplayForViewer({
      activity: {
        type: "Call",
        title: "Call logged",
        body: "Reached voicemail."
      },
      actorName: "Zack Austin",
      viewerRole: "SDR",
      viewerName: "Zack Austin"
    });

    expect(display).toEqual({
      hidden: false,
      title: "Call logged",
      body: "Reached voicemail.",
      actor: "Zack Austin"
    });
  });
});
