import { notFound } from "next/navigation";

import { ContactWorkbench } from "@/components/crm/cockpit/contact-workbench";
import type { FocusLead } from "@/components/crm/cockpit/focus/focus-types";
import { parseBrokerNotes } from "@/lib/phase1/broker-notes";
import { readFastContactDetailModel } from "@/lib/phase1/crm-detail-read-model";
import { readFocusContext } from "@/lib/phase1/focus-context-read-model";
import { readFocusTimelines } from "@/lib/phase1/focus-timeline-read-model";
import { readKeyAccountFields } from "@/lib/phase1/key-account-fields-read-model";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";
import { resolveUserTelephonyIdentity, telephonyIdentityBlockReason } from "@/lib/phase1/telephony-identities";
import { localTimeForState } from "@/lib/phase1/us-timezones";

export const dynamic = "force-dynamic";

// The one cockpit contact page: the SAME dossier that renders inside Focus, plus
// an SDR action rail. Replaces the former TileGrid workbench so there's a single
// contact view. Every "Open full record" / directory click lands here.
export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_crm");

  const model = await readFastContactDetailModel(session, workspaceId, id);
  const contact = model?.readModel.contact;
  const company = model?.readModel.company;
  if (!contact || model?.visible === false) {
    notFound();
  }

  const contactIds = [contact.id];
  const companyIds = contact.companyId ? [contact.companyId] : [];
  const { prisma } = await import("@/lib/prisma");
  const [timelines, context, keyFields, assignment] = await Promise.all([
    readFocusTimelines(workspaceId, contactIds),
    readFocusContext(workspaceId, contactIds),
    readKeyAccountFields(workspaceId, companyIds),
    prisma.sdrAssignment.findFirst({ where: { workspaceId, contactId: contact.id }, select: { id: true } })
  ]);

  // Structured account attributes may live in the notes blob (broker import).
  const broker = parseBrokerNotes(contact.notes ?? "");
  const state = broker?.state || company?.state || "";
  const local = localTimeForState(state);
  const customFields = keyFields.get(contact.companyId ?? "") ?? [];
  const ctx = context.get(contact.id);
  const timeline = timelines.get(contact.id) ?? [];
  const grade = contact.grade ?? "D";
  const companyLocation = broker?.location || [company?.city, company?.state].filter(Boolean).join(", ");

  const lead: FocusLead = {
    id: contact.id,
    assignmentId: assignment?.id ?? "",
    name: displayContactName({ name: contact.name, email: contact.email }),
    title: contact.title ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    hasPhone: Boolean(contact.phone && contact.phone.trim()),
    priority: contact.priority ?? "P4",
    status: contact.status ?? "New",
    slaStatus: "No SLA",
    dueLabel: "",
    dueAtMs: Number.MAX_SAFE_INTEGER,
    overdue: false,
    dueToday: false,
    grade,
    fitReason: contact.fitReason || broker?.fitReason || contact.notes || "",
    companyId: contact.companyId ?? "",
    companyName: company?.name ?? "Unknown account",
    companyDomain: company?.domain ?? "",
    companyIndustry: company?.industry ?? "",
    companyLocation,
    lastTouchLabel: timeline.length ? `Last touch ${timeline[0].meta}` : "No touches yet",
    owner: contact.owner ?? "Unassigned",
    emailEligible: Boolean(
      contact.email && !contact.isSuppressed && !contact.doNotContact && grade !== "D" && grade !== "S"
    ),
    localTimeLabel: local?.label ?? "",
    outsideWindow: local?.outsideWindow ?? false,
    openOpportunity: ctx?.openOpportunity ?? "",
    openWork: ctx?.openWork ?? "",
    keyAccountFields: customFields.length ? customFields : broker?.fields ?? [],
    timeline,
    tasks: ctx?.tasks ?? [],
    opportunities: ctx?.opportunities ?? []
  };

  const identity = resolveUserTelephonyIdentity(session.user);
  const callerLabel = identity ? `${identity.displayName} · ${identity.phoneNumber}` : null;
  const lineBlockReason = identity ? null : telephonyIdentityBlockReason(session.user);

  return <ContactWorkbench lead={lead} callerLabel={callerLabel} lineBlockReason={lineBlockReason} />;
}
