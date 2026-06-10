export type LeadGrade = "A" | "B" | "C" | "D" | "S";
export type Priority = "P1" | "P2" | "P3" | "P4" | "S";
export type LeadStatus =
  | "Ready for SDR"
  | "Needs enrichment"
  | "Suppressed"
  | "In review"
  | "Exported";
export type JobStatus = "Running" | "Completed" | "Queued" | "Paused" | "Failed";
export type OpportunityStage =
  | "Prospecting"
  | "Qualified"
  | "Discovery"
  | "Proposal"
  | "Closed won";

export const workspace = {
  name: "Syncore Tech",
  market: "US outbound workspace",
  seats: 18,
  health: "Operational"
};

export const metrics = [
  {
    label: "Raw leads staged",
    value: 18420,
    note: "+2,114 this week",
    tone: "info"
  },
  {
    label: "Verified email rate",
    value: 71,
    suffix: "%",
    note: "A/B exportable grades",
    tone: "success"
  },
  {
    label: "Suppression blocks",
    value: 392,
    note: "Bounces, DNC, customers",
    tone: "warning"
  },
  {
    label: "Open pipeline",
    value: 682000,
    currency: true,
    note: "Attributed to lead jobs",
    tone: "success"
  }
];

export const pipelineStages = [
  { name: "Extracted", count: 18420, percent: 100 },
  { name: "Normalized", count: 16780, percent: 91 },
  { name: "Deduped", count: 14230, percent: 77 },
  { name: "Verified", count: 10105, percent: 55 },
  { name: "CRM-ready", count: 6240, percent: 34 }
];

export const sourceHealth = [
  {
    source: "Apollo",
    status: "Connected",
    trust: 85,
    credits: "12.4k",
    fields: ["company", "contact", "email", "title"]
  },
  {
    source: "Hunter",
    status: "Connected",
    trust: 80,
    credits: "7.8k",
    fields: ["email finder", "verification", "confidence"]
  },
  {
    source: "Google Places",
    status: "Connected",
    trust: 75,
    credits: "billing cap on",
    fields: ["local business", "phone", "rating", "place id"]
  },
  {
    source: "CSV Upload",
    status: "Ready",
    trust: 55,
    credits: "unmetered",
    fields: ["manual import", "mapped fields", "source label"]
  }
];

export const searchProfiles = [
  {
    id: "sp-texas-dealers",
    name: "Texas Used Car Dealers",
    targetMarket: "US local SMB",
    geographies: ["Texas", "Dallas-Fort Worth", "Houston", "Austin"],
    industries: ["Used car dealer", "Auto finance", "Independent dealership"],
    titles: ["Owner", "General Manager", "Finance Director"],
    sources: ["Google Places", "Apollo", "Hunter"],
    requiredFields: ["Company", "Domain", "Phone", "Decision maker email"],
    scoringProfile: "Local services revenue fit",
    segmentRules: ["High review count", "Weak website", "Owner identified"],
    defaultRouting: "Round-robin: Auto SDR pod",
    estimatedVolume: 2450,
    updatedAt: "Jun 7, 2026",
    complianceNote: "Cold email requires unsubscribe footer; phone outreach checks DNC."
  },
  {
    id: "sp-shopify-klaviyo",
    name: "US Shopify Stores with Klaviyo",
    targetMarket: "Ecommerce",
    geographies: ["United States", "Canada"],
    industries: ["DTC", "Apparel", "Beauty", "Specialty retail"],
    titles: ["Founder", "Head of Growth", "Marketing Manager"],
    sources: ["Apollo", "Apify", "Hunter"],
    requiredFields: ["Domain", "Technology", "Marketing contact", "Verified email"],
    scoringProfile: "Ecommerce growth fit",
    segmentRules: ["Klaviyo detected", "Hiring marketing", "50k+ monthly visits"],
    defaultRouting: "Territory: Ecommerce SDR pod",
    estimatedVolume: 6120,
    updatedAt: "Jun 6, 2026",
    complianceNote: "Only sanctioned sources and imported LinkedIn research are allowed."
  },
  {
    id: "sp-architect-ca",
    name: "Architect Firms in California",
    targetMarket: "Professional services",
    geographies: ["California", "Bay Area", "Los Angeles", "San Diego"],
    industries: ["Architecture", "Interior design", "Commercial design"],
    titles: ["Principal", "Managing Partner", "Operations Manager"],
    sources: ["Google Places", "CSV Upload", "Hunter"],
    requiredFields: ["Company", "Website", "Main phone", "Owner email"],
    scoringProfile: "Professional services owner-led",
    segmentRules: ["10+ employees", "Commercial projects", "Missing CRM"],
    defaultRouting: "Manual manager review",
    estimatedVolume: 1280,
    updatedAt: "Jun 4, 2026",
    complianceNote: "Source labels required for all CSV imports."
  }
];

export const leadJobs = [
  {
    id: "job-1042",
    name: "Texas Used Car Dealers - June Campaign",
    profileId: "sp-texas-dealers",
    status: "Running" as JobStatus,
    progress: 68,
    sources: ["Google Places", "Apollo", "Hunter"],
    raw: 2204,
    normalized: 1968,
    duplicates: 284,
    suppressed: 67,
    verified: 1088,
    enriched: 902,
    exported: 0,
    pushedToCrm: 418,
    actualCost: 384,
    startedAt: "Jun 8, 2026 4:20 PM",
    eta: "24 min",
    errorSummary: "Hunter retry queue: 18 pending"
  },
  {
    id: "job-1038",
    name: "Shopify + Klaviyo Growth Contacts",
    profileId: "sp-shopify-klaviyo",
    status: "Completed" as JobStatus,
    progress: 100,
    sources: ["Apollo", "Apify", "Hunter"],
    raw: 8120,
    normalized: 7604,
    duplicates: 1320,
    suppressed: 146,
    verified: 4210,
    enriched: 3894,
    exported: 2600,
    pushedToCrm: 1950,
    actualCost: 1028,
    startedAt: "Jun 6, 2026 9:05 AM",
    eta: "Done",
    errorSummary: "No open failures"
  },
  {
    id: "job-1036",
    name: "California Architect Owner List",
    profileId: "sp-architect-ca",
    status: "Paused" as JobStatus,
    progress: 41,
    sources: ["Google Places", "CSV Upload"],
    raw: 1280,
    normalized: 1052,
    duplicates: 203,
    suppressed: 22,
    verified: 0,
    enriched: 0,
    exported: 0,
    pushedToCrm: 0,
    actualCost: 74,
    startedAt: "Jun 5, 2026 2:18 PM",
    eta: "Waiting on approval",
    errorSummary: "CSV source label review required"
  }
];

export const stagedLeads = [
  {
    id: "lead-001",
    contactName: "Maya Hernandez",
    title: "General Manager",
    company: "Lone Star Auto Group",
    domain: "lonestarautogroup.com",
    email: "maya@lonestarautogroup.com",
    phone: "+1 214 555 0187",
    city: "Dallas",
    state: "TX",
    source: "Google Places + Hunter",
    emailGrade: "A" as LeadGrade,
    score: 91,
    priority: "P1" as Priority,
    status: "Ready for SDR" as LeadStatus,
    segment: "High review dealer",
    owner: "Ari Patel",
    verification: "Mailbox verified, MX healthy",
    signals: ["4.6 rating", "220 reviews", "Owner email found"],
    lastSeen: "Jun 8, 2026"
  },
  {
    id: "lead-002",
    contactName: "Daniel Kim",
    title: "Founder",
    company: "Northline Outfitters",
    domain: "northlineoutfitters.com",
    email: "daniel@northlineoutfitters.com",
    phone: "+1 206 555 0144",
    city: "Seattle",
    state: "WA",
    source: "Apollo + Apify",
    emailGrade: "B" as LeadGrade,
    score: 84,
    priority: "P1" as Priority,
    status: "Exported" as LeadStatus,
    segment: "Klaviyo DTC",
    owner: "Mina Brooks",
    verification: "Catch-all domain, low risk",
    signals: ["Shopify", "Klaviyo", "Hiring growth marketer"],
    lastSeen: "Jun 7, 2026"
  },
  {
    id: "lead-003",
    contactName: "Priya Raman",
    title: "Principal",
    company: "Raman Studio Architecture",
    domain: "ramanstudioarch.com",
    email: "hello@ramanstudioarch.com",
    phone: "+1 415 555 0163",
    city: "San Francisco",
    state: "CA",
    source: "CSV Upload",
    emailGrade: "C" as LeadGrade,
    score: 66,
    priority: "P2" as Priority,
    status: "Needs enrichment" as LeadStatus,
    segment: "Professional services",
    owner: "Unassigned",
    verification: "Role email; direct owner email missing",
    signals: ["Commercial projects", "Website active", "CSV confidence medium"],
    lastSeen: "Jun 5, 2026"
  },
  {
    id: "lead-004",
    contactName: "Evan Miles",
    title: "Marketing Manager",
    company: "Cedar House Goods",
    domain: "cedarhousegoods.com",
    email: "evan@cedarhousegoods.com",
    phone: "+1 303 555 0198",
    city: "Denver",
    state: "CO",
    source: "Apollo",
    emailGrade: "D" as LeadGrade,
    score: 48,
    priority: "P4" as Priority,
    status: "In review" as LeadStatus,
    segment: "Ecommerce partial fit",
    owner: "Mina Brooks",
    verification: "Mailbox failed; do not export as verified",
    signals: ["Shopify", "No recent hiring", "Email failure"],
    lastSeen: "Jun 6, 2026"
  },
  {
    id: "lead-005",
    contactName: "Oliver Smith",
    title: "Owner",
    company: "Smith Family Motors",
    domain: "smithfamilymotors.com",
    email: "oliver@smithfamilymotors.com",
    phone: "+1 713 555 0112",
    city: "Houston",
    state: "TX",
    source: "Google Places",
    emailGrade: "S" as LeadGrade,
    score: 0,
    priority: "S" as Priority,
    status: "Suppressed" as LeadStatus,
    segment: "Existing customer",
    owner: "Blocked",
    verification: "Suppressed: active customer account",
    signals: ["Customer domain", "Suppression match", "No export"],
    lastSeen: "Jun 8, 2026"
  }
];

export const sdrQueues = [
  {
    owner: "Ari Patel",
    assigned: 146,
    dueToday: 32,
    overdue: 7,
    bookedMeetings: 9,
    focus: "Texas dealer P1"
  },
  {
    owner: "Mina Brooks",
    assigned: 128,
    dueToday: 26,
    overdue: 3,
    bookedMeetings: 12,
    focus: "Ecommerce growth"
  },
  {
    owner: "Leo Grant",
    assigned: 118,
    dueToday: 21,
    overdue: 0,
    bookedMeetings: 6,
    focus: "Professional services"
  }
];

export const accounts = [
  {
    id: "acct-lone-star",
    name: "Lone Star Auto Group",
    domain: "lonestarautogroup.com",
    industry: "Automotive retail",
    location: "Dallas, TX",
    employees: "51-200",
    revenueBand: "$25M-$50M",
    source: "Texas Used Car Dealers - June Campaign",
    score: 91,
    priority: "P1" as Priority,
    owner: "Ari Patel",
    stage: "Discovery" as OpportunityStage,
    amount: 64000,
    contacts: 4,
    openTasks: 3,
    lastActivity: "Call logged today",
    compliance: "CAN-SPAM footer required; DNC clear",
    description: "Multi-location independent dealership group with strong review volume and active financing offers."
  },
  {
    id: "acct-northline",
    name: "Northline Outfitters",
    domain: "northlineoutfitters.com",
    industry: "Ecommerce",
    location: "Seattle, WA",
    employees: "11-50",
    revenueBand: "$5M-$10M",
    source: "Shopify + Klaviyo Growth Contacts",
    score: 84,
    priority: "P1" as Priority,
    owner: "Mina Brooks",
    stage: "Qualified" as OpportunityStage,
    amount: 42000,
    contacts: 3,
    openTasks: 2,
    lastActivity: "Positive email reply",
    compliance: "Unsubscribe mechanism attached",
    description: "Outdoor apparel brand running Shopify and Klaviyo with recent demand-generation hiring."
  },
  {
    id: "acct-raman",
    name: "Raman Studio Architecture",
    domain: "ramanstudioarch.com",
    industry: "Architecture",
    location: "San Francisco, CA",
    employees: "11-50",
    revenueBand: "$2M-$5M",
    source: "California Architect Owner List",
    score: 66,
    priority: "P2" as Priority,
    owner: "Leo Grant",
    stage: "Prospecting" as OpportunityStage,
    amount: 28000,
    contacts: 2,
    openTasks: 4,
    lastActivity: "Needs direct email enrichment",
    compliance: "CSV source label approved",
    description: "Commercial design studio with public project portfolio and incomplete contact coverage."
  },
  {
    id: "acct-cedar",
    name: "Cedar House Goods",
    domain: "cedarhousegoods.com",
    industry: "Ecommerce",
    location: "Denver, CO",
    employees: "1-10",
    revenueBand: "$1M-$2M",
    source: "Shopify + Klaviyo Growth Contacts",
    score: 48,
    priority: "P4" as Priority,
    owner: "Mina Brooks",
    stage: "Prospecting" as OpportunityStage,
    amount: 12000,
    contacts: 1,
    openTasks: 1,
    lastActivity: "Email verification failed",
    compliance: "Do not export until verified",
    description: "Small specialty goods shop with partial technology match and weak contact confidence."
  }
];

export const contacts = [
  {
    id: "contact-maya",
    accountId: "acct-lone-star",
    name: "Maya Hernandez",
    title: "General Manager",
    email: "maya@lonestarautogroup.com",
    phone: "+1 214 555 0187",
    grade: "A" as LeadGrade,
    score: 91,
    status: "Working",
    owner: "Ari Patel"
  },
  {
    id: "contact-rob",
    accountId: "acct-lone-star",
    name: "Rob Ellis",
    title: "Finance Director",
    email: "rob@lonestarautogroup.com",
    phone: "+1 214 555 0152",
    grade: "B" as LeadGrade,
    score: 78,
    status: "Follow-up",
    owner: "Ari Patel"
  },
  {
    id: "contact-daniel",
    accountId: "acct-northline",
    name: "Daniel Kim",
    title: "Founder",
    email: "daniel@northlineoutfitters.com",
    phone: "+1 206 555 0144",
    grade: "B" as LeadGrade,
    score: 84,
    status: "Replied",
    owner: "Mina Brooks"
  },
  {
    id: "contact-priya",
    accountId: "acct-raman",
    name: "Priya Raman",
    title: "Principal",
    email: "hello@ramanstudioarch.com",
    phone: "+1 415 555 0163",
    grade: "C" as LeadGrade,
    score: 66,
    status: "Research",
    owner: "Leo Grant"
  },
  {
    id: "contact-evan",
    accountId: "acct-cedar",
    name: "Evan Miles",
    title: "Marketing Manager",
    email: "evan@cedarhousegoods.com",
    phone: "+1 303 555 0198",
    grade: "D" as LeadGrade,
    score: 48,
    status: "Hold",
    owner: "Mina Brooks"
  }
];

export const activities = [
  {
    id: "act-001",
    accountId: "acct-lone-star",
    type: "Call",
    title: "Discovery call logged",
    detail: "Maya confirmed three locations and asked for pricing before Friday.",
    timestamp: "Jun 8, 2026 5:02 PM",
    actor: "Ari Patel"
  },
  {
    id: "act-002",
    accountId: "acct-lone-star",
    type: "Task",
    title: "Send dealer ROI one-pager",
    detail: "Due tomorrow with financing workflow examples.",
    timestamp: "Jun 9, 2026 9:00 AM",
    actor: "System"
  },
  {
    id: "act-003",
    accountId: "acct-northline",
    type: "Email",
    title: "Positive reply received",
    detail: "Daniel wants to compare list quality against their current agency.",
    timestamp: "Jun 7, 2026 3:28 PM",
    actor: "Mina Brooks"
  },
  {
    id: "act-004",
    accountId: "acct-raman",
    type: "Note",
    title: "Owner contact incomplete",
    detail: "Role email is valid but direct inbox should be enriched before SDR touch.",
    timestamp: "Jun 6, 2026 11:16 AM",
    actor: "Leo Grant"
  },
  {
    id: "act-005",
    accountId: "acct-cedar",
    type: "Verification",
    title: "Mailbox verification failed",
    detail: "D-grade email blocked from verified export.",
    timestamp: "Jun 6, 2026 8:45 AM",
    actor: "Verification worker"
  }
];

export const exportTemplates = [
  {
    id: "exp-template-verified",
    name: "Verified email leads",
    description: "Contacts with A/B grades, suppression clear, direct or acceptable catch-all.",
    columns: ["company", "contact", "title", "email", "grade", "score", "segment", "owner"],
    eligible: 6240
  },
  {
    id: "exp-template-phone",
    name: "Phone-ready local leads",
    description: "Valid main phone or direct phone, DNC clear, account priority P1-P3.",
    columns: ["company", "phone", "city", "state", "rating", "segment", "owner"],
    eligible: 3875
  },
  {
    id: "exp-template-sdr",
    name: "SDR assignment queue",
    description: "Assignment CSV with owner, due date, recommended channel, and CRM account link.",
    columns: ["owner", "priority", "due_date", "channel", "account_url", "next_task"],
    eligible: 418
  }
];

export const exportHistory = [
  {
    id: "export-482",
    name: "Shopify Klaviyo P1/P2 - verified",
    records: 2600,
    createdBy: "Nora West",
    createdAt: "Jun 7, 2026 10:44 AM",
    sourceJob: "job-1038",
    status: "Ready"
  },
  {
    id: "export-477",
    name: "Texas dealers phone preview",
    records: 620,
    createdBy: "Ari Patel",
    createdAt: "Jun 8, 2026 3:11 PM",
    sourceJob: "job-1042",
    status: "Draft"
  }
];

export const suppressionSummary = [
  { label: "Unsubscribed emails", count: 912, policy: "Global block" },
  { label: "Hard bounces", count: 1284, policy: "Global block" },
  { label: "Do-not-call phones", count: 403, policy: "Phone/SMS block" },
  { label: "Existing customers", count: 229, policy: "Export block" }
];

export function getAccount(id: string) {
  return accounts.find((account) => account.id === id);
}

export function getAccountContacts(accountId: string) {
  return contacts.filter((contact) => contact.accountId === accountId);
}

export function getAccountActivities(accountId: string) {
  return activities.filter((activity) => activity.accountId === accountId);
}
