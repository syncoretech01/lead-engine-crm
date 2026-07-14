"use client";

import * as React from "react";
import { Phone } from "lucide-react";

import { useCall } from "@/components/call/call-context";
import { ContactDossier } from "@/components/crm/cockpit/contact-dossier";
import { QuickActions } from "@/components/crm/cockpit/quick-actions";
import { leadBlockReason, leadCallTarget, leadCompliance, type FocusLead } from "@/components/crm/cockpit/focus/focus-types";

// The standalone cockpit contact page: the SAME dossier that renders inside Focus
// (identity + compliance + scan strip + 5 tabs), plus a right action rail — Call
// (via the modal dialer, since there's no dock here) + the shared SDR quick
// actions + a call-readiness check.
export function ContactWorkbench({
  lead,
  callerLabel,
  lineBlockReason
}: {
  lead: FocusLead;
  callerLabel: string | null;
  lineBlockReason: string | null;
}) {
  const { openCall } = useCall();
  const block = leadBlockReason(lead, lineBlockReason);
  const compliance = leadCompliance(lead);
  const onCall = React.useCallback(() => {
    if (block) return;
    openCall(leadCallTarget(lead, callerLabel, lineBlockReason));
  }, [block, lead, callerLabel, lineBlockReason, openCall]);

  return (
    <div className="cockpit flex min-h-[calc(100vh-3.5rem)] w-full bg-co-page">
      <main className="min-w-0 flex-1 overflow-y-auto bg-white">
        <ContactDossier lead={lead} onCall={onCall} callBlocked={block} isFullRecord />
      </main>

      <aside className="hidden w-[360px] shrink-0 flex-col gap-4 border-l border-co-border bg-co-sunken p-4 xl:flex [@media(max-width:1200px)]:w-[320px]">
        <div className="rounded-[10px] border border-[#bcd8ff] bg-[#eaf3ff] p-3.5">
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-blue-dark">Next best action</div>
          <div className="mt-1 text-[13px] font-bold text-co-ink">{block ? block : "Call now"}</div>
          <button
            type="button"
            disabled={Boolean(block)}
            onClick={onCall}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-co-blue text-[13px] font-bold text-white transition-colors hover:bg-co-blue-hover disabled:cursor-not-allowed disabled:bg-[#dce5ee] disabled:text-co-muted-2"
          >
            <Phone className="size-4" aria-hidden="true" />
            {block ? "Call unavailable" : lead.hasPhone ? `Call ${lead.phone}` : "No phone"}
          </button>
        </div>

        <QuickActions lead={lead} />

        <div>
          <div className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Call readiness</div>
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-co-border bg-white p-3">
            <ReadyRow ok={!lineBlockReason} label="Your line" value={callerLabel ?? lineBlockReason ?? "No line configured"} />
            <ReadyRow ok={lead.hasPhone} label="Contact phone" value={lead.hasPhone ? lead.phone : "No phone on file"} />
            <ReadyRow ok={compliance.clear} label="Compliance" value={compliance.title} />
            <ReadyRow
              ok={Boolean(lead.localTimeLabel) && !lead.outsideWindow}
              warn={lead.outsideWindow}
              label="Local time"
              value={
                lead.localTimeLabel
                  ? lead.outsideWindow
                    ? `${lead.localTimeLabel} · outside window`
                    : lead.localTimeLabel
                  : "Unknown"
              }
            />
          </div>
        </div>
      </aside>
    </div>
  );
}

function ReadyRow({ ok, warn, label, value }: { ok: boolean; warn?: boolean; label: string; value: string }) {
  const dot = ok ? "bg-co-teal" : warn ? "bg-co-amber-dot" : "bg-co-red";
  return (
    <div className="flex items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className="w-[118px] shrink-0 text-[11.5px] text-co-text-3">{label}</span>
      <span className="truncate text-[11.5px] font-semibold text-co-ink">{value}</span>
    </div>
  );
}
