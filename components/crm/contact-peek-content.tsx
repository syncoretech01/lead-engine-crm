"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Building2, Copy, Mail } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SoftphoneButton } from "@/components/softphone-button";
import type { CrmContactListRow } from "@/lib/phase1/crm-contacts-read-model";
import { contactDisplayName, gradeTone, priorityTone } from "@/lib/crm-contact-presentation";

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
  callBlockReason
}: {
  contact: CrmContactListRow;
  callerLabel?: string;
  callBlockReason?: string;
}) {
  const router = useRouter();
  const href = `/crm/contacts/${contact.id}`;
  const name = contactDisplayName(contact);

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
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-foreground">{name}</h2>
            {contact.title ? <p className="truncate text-sm text-muted-foreground">{contact.title}</p> : null}
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
              contactName={name}
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
          <StatusBadge label={contact.priority} tone={priorityTone(contact.priority)} />
        </Field>
        <Field label="Grade">
          <StatusBadge label={contact.grade} tone={gradeTone(contact.grade)} />
        </Field>
        <Field label="Score">
          <span className="tabular-nums">{contact.score}</span>
        </Field>
        <Field label="Owner">{contact.owner}</Field>
        <Field label="Last activity">{contact.lastActivity}</Field>
      </div>

      <div className="border-t p-5">
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
