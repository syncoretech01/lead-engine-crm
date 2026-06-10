import { randomUUID } from "node:crypto";
import type {
  AppState,
  Company,
  Contact,
  LeadGrade,
  LeadScore,
  Priority,
  RecordSegment,
  SegmentCondition,
  SegmentRule
} from "@/lib/phase1/types";

export function defaultSegmentRules(workspaceId: string, now = new Date().toISOString()): SegmentRule[] {
  return [
    {
      id: "segment-ecommerce-growth",
      workspaceId,
      name: "Ecommerce growth fit",
      description: "DTC, Shopify, Klaviyo, ecommerce, or growth-role signals.",
      outputSegment: "Ecommerce growth",
      scoreBoost: 10,
      priorityOverride: "P1",
      conditions: {
        industries: ["ecommerce", "retail", "dtc"],
        titleKeywords: ["growth", "marketing", "founder"],
        domainKeywords: [],
        technologyKeywords: ["shopify", "klaviyo"],
        signalKeywords: ["hiring growth", "email marketing"],
        grades: ["A", "B", "C"],
        minScore: 50,
        requirePhone: false
      },
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "segment-local-owner",
      workspaceId,
      name: "Local owner-led business",
      description: "Owner, founder, dealer, automotive, or local services lead with phone readiness.",
      outputSegment: "Local owner-led",
      scoreBoost: 8,
      priorityOverride: "P1",
      conditions: {
        industries: ["auto", "dealer", "home services", "local services", "automotive"],
        titleKeywords: ["owner", "founder", "general manager"],
        domainKeywords: [],
        technologyKeywords: [],
        signalKeywords: ["phone ready", "local business"],
        grades: ["A", "B", "C"],
        minScore: 45,
        requirePhone: true
      },
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "segment-professional-services",
      workspaceId,
      name: "Professional services",
      description: "Architecture, design, consulting, and principal/partner-led services firms.",
      outputSegment: "Professional services",
      scoreBoost: 6,
      priorityOverride: "P2",
      conditions: {
        industries: ["architecture", "design", "professional services", "consulting"],
        titleKeywords: ["principal", "partner", "operations", "owner"],
        domainKeywords: [],
        technologyKeywords: [],
        signalKeywords: [],
        grades: ["A", "B", "C"],
        minScore: 45,
        requirePhone: false
      },
      active: true,
      createdAt: now,
      updatedAt: now
    }
  ];
}

export function applySegmentsAndScores(state: AppState, workspaceId: string) {
  state.recordSegments = state.recordSegments.filter((segment) => segment.workspaceId !== workspaceId);
  let segmented = 0;
  let scored = 0;

  for (const contact of state.contacts.filter((item) => item.workspaceId === workspaceId)) {
    const company = state.companies.find((item) => item.id === contact.companyId);
    if (!company) {
      continue;
    }

    const matches = state.segmentRules.filter(
      (rule) => rule.workspaceId === workspaceId && rule.active && segmentRuleMatches(rule, contact, company)
    );

    for (const rule of matches) {
      state.recordSegments.push({
        id: `record-segment-${randomUUID()}`,
        workspaceId,
        contactId: contact.id,
        companyId: company.id,
        segmentRuleId: rule.id,
        segment: rule.outputSegment,
        scoreContribution: rule.scoreBoost,
        assignedAt: new Date().toISOString()
      });
      segmented += 1;
    }

    const score = calculateLeadScore(contact, company, matches);
    state.leadScores.unshift(score);
    contact.score = score.score;
    contact.priority = score.priority;
    contact.segment = matches[0]?.outputSegment ?? contact.segment;
    contact.fitReason = score.reasons.join("; ");
    contact.updatedAt = score.calculatedAt;

    company.score = Math.max(company.score, score.score);
    company.priority = strongerPriority(company.priority, score.priority);
    company.updatedAt = score.calculatedAt;
    scored += 1;
  }

  return { segmented, scored };
}

export function createSegmentRuleFromForm({
  workspaceId,
  name,
  description,
  outputSegment,
  scoreBoost,
  priorityOverride,
  conditions
}: {
  workspaceId: string;
  name: string;
  description: string;
  outputSegment: string;
  scoreBoost: number;
  priorityOverride?: Priority;
  conditions: SegmentCondition;
}): SegmentRule {
  const now = new Date().toISOString();
  return {
    id: `segment-${randomUUID()}`,
    workspaceId,
    name,
    description,
    outputSegment,
    scoreBoost,
    priorityOverride,
    conditions,
    active: true,
    createdAt: now,
    updatedAt: now
  };
}

export function calculateLeadScore(contact: Contact, company: Company, matchedRules: SegmentRule[]): LeadScore {
  const verification = verificationScore(contact.grade);
  const enrichment = enrichmentScore(contact, company);
  const segment = Math.min(
    matchedRules.reduce((total, rule) => total + rule.scoreBoost, 0),
    20
  );
  const fit = fitScore(contact, company);
  const compliance = contact.isSuppressed ? -100 : 0;
  const score = Math.max(0, Math.min(100, verification + enrichment + segment + fit + compliance));
  const priority = contact.isSuppressed
    ? "S"
    : matchedRules.find((rule) => rule.priorityOverride)?.priorityOverride ?? priorityForScore(score, contact.grade);
  const reasons = [
    `${contact.grade} verification contributed ${verification}`,
    `${Math.round(contact.enrichmentCoverage ?? 0)}% contact enrichment coverage`,
    `${Math.round(company.enrichmentCoverage ?? 0)}% company enrichment coverage`
  ];

  if (matchedRules.length) {
    reasons.push(`Matched ${matchedRules.map((rule) => rule.outputSegment).join(", ")}`);
  }

  if (contact.isSuppressed) {
    reasons.push("Suppression overrides all scoring");
  }

  return {
    id: `score-${randomUUID()}`,
    workspaceId: contact.workspaceId,
    contactId: contact.id,
    companyId: company.id,
    score,
    priority,
    breakdown: {
      verification,
      enrichment,
      segment,
      fit,
      compliance
    },
    reasons,
    calculatedAt: new Date().toISOString()
  };
}

function segmentRuleMatches(rule: SegmentRule, contact: Contact, company: Company) {
  const haystack = [
    contact.title,
    contact.segment,
    contact.department ?? "",
    contact.seniority ?? "",
    company.industry,
    company.domain,
    ...(company.technologies ?? []),
    ...(company.signals ?? [])
  ]
    .join(" ")
    .toLowerCase();

  if (!rule.conditions.grades.includes(contact.grade)) {
    return false;
  }

  if (contact.score < rule.conditions.minScore) {
    return false;
  }

  if (rule.conditions.requirePhone && !contact.phone) {
    return false;
  }

  const buckets = [
    rule.conditions.industries,
    rule.conditions.titleKeywords,
    rule.conditions.domainKeywords,
    rule.conditions.technologyKeywords,
    rule.conditions.signalKeywords
  ].filter((bucket) => bucket.length > 0);

  if (buckets.length === 0) {
    return true;
  }

  return buckets.some((bucket) => bucket.some((keyword) => haystack.includes(keyword.toLowerCase())));
}

function verificationScore(grade: LeadGrade) {
  if (grade === "A") return 42;
  if (grade === "B") return 34;
  if (grade === "C") return 22;
  if (grade === "D") return 8;
  return 0;
}

function enrichmentScore(contact: Contact, company: Company) {
  const contactCoverage = contact.enrichmentCoverage ?? 0;
  const companyCoverage = company.enrichmentCoverage ?? 0;
  return Math.round(((contactCoverage + companyCoverage) / 200) * 24);
}

function fitScore(contact: Contact, company: Company) {
  let score = 12;
  if (contact.seniority && ["owner", "founder", "c-level", "vp", "director"].includes(contact.seniority.toLowerCase())) {
    score += 8;
  }
  if (company.employeeBand && company.employeeBand !== "Unknown") {
    score += 4;
  }
  if ((company.signals ?? []).length > 0) {
    score += Math.min((company.signals ?? []).length * 2, 8);
  }
  return Math.min(score, 24);
}

function priorityForScore(score: number, grade: LeadGrade): Priority {
  if (grade === "S") return "S";
  if (score >= 82) return "P1";
  if (score >= 68) return "P2";
  if (score >= 52) return "P3";
  return "P4";
}

function strongerPriority(left: Priority, right: Priority): Priority {
  const rank: Record<Priority, number> = { P1: 5, P2: 4, P3: 3, P4: 2, S: 1 };
  return rank[right] > rank[left] ? right : left;
}
