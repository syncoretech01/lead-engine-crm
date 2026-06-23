import { describe, expect, it } from "vitest";
import { pickWaterfallTemplateForProfile } from "@/lib/phase1/waterfall-recommender";
import type { WaterfallTemplate } from "@/lib/phase1/types";

function tpl(id: string, campaignType: string, name: string): WaterfallTemplate {
  return {
    id,
    workspaceId: "ws",
    name,
    campaignType,
    status: "Active",
    isDefault: true,
    outreachChannel: "both",
    requiredFields: [],
    steps: [],
    createdAt: "",
    updatedAt: ""
  } as WaterfallTemplate;
}

const templates = [
  tpl("t-local", "local_business", "Local Business"),
  tpl("t-email", "email_first_call_later", "Email First"),
  tpl("t-li", "linkedin_sales_navigator", "LinkedIn")
];

describe("pickWaterfallTemplateForProfile", () => {
  it("picks the local-business template for local ICPs", () => {
    expect(pickWaterfallTemplateForProfile({ industries: ["Auto Repair"], templates }).templateId).toBe("t-local");
  });

  it("picks the LinkedIn template when signaled", () => {
    expect(pickWaterfallTemplateForProfile({ segments: ["LinkedIn Sales Navigator list"], templates }).templateId).toBe("t-li");
  });

  it("defaults to email-first for a general B2B ICP", () => {
    expect(pickWaterfallTemplateForProfile({ industries: ["Wholesale"], titles: ["Buyer"], templates }).templateId).toBe("t-email");
  });

  it("falls back to the first template when no campaign type matches", () => {
    const only = [tpl("t-x", "company_first_abm", "ABM")];
    expect(pickWaterfallTemplateForProfile({ industries: ["Wholesale"], templates: only }).templateId).toBe("t-x");
  });
});
