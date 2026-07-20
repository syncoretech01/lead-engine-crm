"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Building2, ChevronLeft, ChevronRight, Copy, Mail } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { SoftphoneButton } from "@/components/softphone-button";
import type { PeekAssignment } from "@/lib/crm-contact-presentation";

/**
 * Normalized shape the contact peek renders. Both the Contacts directory and
 * the My Contacts table map their own row into this so the two peeks stay
 * identical — one component, one layout, no drift.
 */
export type PeekContact = {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  companyId: string;
  companyName: string;
  status: string;
  grade: string;
  gradeTone: BadgeTone;
  priority: string;
  priorityTone: BadgeTone;
  owner: string;
  /** Free-text notes shown at the bottom of the peek. */
  notes?: string;
  /** Present when the contact is assigned to an SDR (always on My Contacts). */
  assignment?: PeekAssignment;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

export function ContactPeekContent({
  contact,
  callerLabel,
  callBlockReason,
  detailHref,
  queueNavigation
}: {
  contact: PeekContact;
  callerLabel?: string;
  callBlockReason?: string;
  detailHref?: string;
  queueNavigation?: {
    onPrevious?: () => void;
    onNext?: () => void;
    positionLabel?: string;
  };
}) {
  const router = useRouter();
  const href = detailHref ?? `/crm/contacts/${contact.id}`;

  React.useEffect(() => {
    router.prefetch(href);
  }, [router, href]);

  const copy = (value: string, label: string) => {
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`));
  };

  return (
    <>
      <div className="border-b p-5">
        <div className="flex items-start gap-3">
          <Avatar className="size-11 rounded-lg">
            <AvatarFallback className="rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              {initials(contact.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-foreground">{contact.name}</h2>
            {contact.title ? (
              <p className="truncate text-sm text-muted-foreground">{contact.title}</p>
            ) : null}
            {contact.companyId ? (
              <Link
                href={`/crm/accounts/${contact.companyId}`}
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Building2 className="size-3" aria-hidden="true" />
                {contact.companyName}
              </Link>
            ) : null}
          </div>
          <StatusBadge label={contact.status} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {contact.phone ? (
            <SoftphoneButton
              contactId={contact.id}
              contactName={contact.name}
              phone={contact.phone}
              callerLabel={callerLabel}
              blockReason={callBlockReason}
            />
          ) : null}
          {contact.email ? (
            <Button asChild size="sm" variant="outline">
              <a href={`mailto:${contact.email}`}>
                <Mail aria-hidden="true" />
                Email
              </a>
            </Button>
          ) : null}
          {contact.email ? (
            <Button size="sm" variant="outline" onClick={() => copy(contact.email, "Email")}>
              <Copy aria-hidden="true" />
              Copy email
            </Button>
          ) : null}
          {contact.phone ? (
            <Button size="sm" variant="outline" onClick={() => copy(contact.phone, "Phone")}>
              <Copy aria-hidden="true" />
              Copy phone
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 divide-y px-5">
        <Field label="Email">{contact.email || "—"}</Field>
        <Field label="Phone">{contact.phone || "—"}</Field>
        <Field label="Account">{contact.companyName || "—"}</Field>
        <Field label="Priority">
          <StatusBadge label={contact.priority} tone={contact.priorityTone} />
        </Field>
        <Field label="Grade">
          <StatusBadge label={contact.grade} tone={contact.gradeTone} />
        </Field>
        {contact.assignment ? (
          <>
            <Field label="Assigned">{contact.assignment.assignedRelative}</Field>
            <Field label="Last touch">{contact.assignment.lastTouchLabel}</Field>
          </>
        ) : (
          <Field label="Assigned">Unassigned</Field>
        )}
        <Field label="Owner">{contact.owner || "—"}</Field>
      </div>

      {contact.notes ? (
        <div className="border-t px-5 py-4">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Notes</p>
          <p className="whitespace-pre-line text-sm text-foreground">{contact.notes}</p>
        </div>
      ) : null}

      <div className="border-t p-5">
        {queueNavigation ? (
          <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={queueNavigation.onPrevious}
              disabled={!queueNavigation.onPrevious}
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">{queueNavigation.positionLabel}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={queueNavigation.onNext}
              disabled={!queueNavigation.onNext}
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        <Button asChild className="w-full">
          <Link href={href}>
            Open full record
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </>
  );
}
