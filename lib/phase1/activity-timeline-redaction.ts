import type { Activity, WorkspaceRole } from "@/lib/phase1/types";

type TimelineActivityDisplayInput = {
  activity: Pick<Activity, "type" | "title" | "body">;
  actorName: string;
  viewerRole: WorkspaceRole;
  viewerName: string;
};

export type TimelineActivityDisplay =
  | {
      hidden: false;
      title: string;
      body?: string;
      actor?: string;
    }
  | {
      hidden: true;
    };

const assignmentTitlePattern = /^(Assigned|Reassigned) to (.+)$/;

export function timelineActivityDisplayForViewer(input: TimelineActivityDisplayInput): TimelineActivityDisplay {
  if (input.viewerRole !== "SDR" || input.activity.type !== "Status change") {
    return {
      hidden: false,
      title: input.activity.title,
      body: input.activity.body || undefined,
      actor: input.actorName
    };
  }

  const assignmentTitle = input.activity.title.match(assignmentTitlePattern);
  if (!assignmentTitle) {
    return {
      hidden: false,
      title: input.activity.title,
      body: input.activity.body || undefined,
      actor: input.actorName
    };
  }

  const targetName = assignmentTitle[2].trim();
  if (targetName.toLowerCase() !== input.viewerName.trim().toLowerCase()) {
    return { hidden: true };
  }

  return {
    hidden: false,
    title: `Assigned to ${targetName}`,
    actor: "Manager"
  };
}
