"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Check,
  Circle,
  Grid3x3,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Radio,
  StickyNote,
  X
} from "lucide-react";

import { saveCallWrapupAction } from "@/app/actions";
import { useCall } from "@/components/call/call-context";
import { CoPill } from "@/components/crm/cockpit/co-table";
import { QuickActions } from "@/components/crm/cockpit/quick-actions";
import { leadBlockReason, leadCallTarget, type FocusLead } from "@/components/crm/cockpit/focus/focus-types";
import type { WrapupSummary } from "@/components/crm/cockpit/focus/use-focus-session";

const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

// Disposition → default lead status + side-effects (README §70). The SDR can
// override the status in the wrap-up; these are the honest defaults.
type OutcomeDef = {
  id: string;
  status: string;
  nextAction: string;
  followUp?: FollowUpPreset;
  opp?: boolean;
  meeting?: boolean;
};
const OUTCOMES: OutcomeDef[] = [
  { id: "Connected", status: "Contacted", nextAction: "Log the call and set a follow-up" },
  { id: "No answer", status: "Working", nextAction: "Try again later or send a 1:1 email" },
  { id: "Voicemail", status: "Contacted", nextAction: "Follow up after the voicemail" },
  { id: "Busy", status: "Working", nextAction: "Retry shortly" },
  { id: "Wrong number", status: "Invalid", nextAction: "Verify the number on the record" },
  { id: "Not interested", status: "Disqualified", nextAction: "Nurture or disqualify" },
  { id: "Follow-up required", status: "Working", followUp: "tomorrow", nextAction: "Complete the follow-up you set" },
  { id: "Qualified", status: "Qualified", opp: true, nextAction: "Advance the opportunity" },
  { id: "Meeting booked", status: "Meeting Booked", meeting: true, nextAction: "Prep the meeting" },
  { id: "Do not contact", status: "Suppressed", nextAction: "Suppress and stop outreach" }
];

const LEAD_STATUSES = [
  "Contacted",
  "Working",
  "Interested",
  "Replied",
  "Meeting Booked",
  "Qualified",
  "Proposal Sent",
  "Nurture",
  "Disqualified",
  "Invalid",
  "Suppressed"
];

const OPP_STAGES = ["Prospecting", "Qualified", "Discovery", "Proposal", "Closed won"];

const NOTE_CHIPS = [
  "Pain point",
  "Current provider",
  "Objection",
  "Decision maker",
  "Budget",
  "Timing",
  "Requested info",
  "Next step"
];

type FollowUpPreset = "later" | "tomorrow" | "custom" | "none";
const FOLLOWUP_PRESETS: Array<{ id: FollowUpPreset; label: string }> = [
  { id: "later", label: "Later today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "custom", label: "Custom" }
];

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Resolve a follow-up preset to an ISO datetime (client-side — Date is fine here).
function presetToIso(preset: FollowUpPreset, customValue: string): string | undefined {
  if (preset === "none") return undefined;
  if (preset === "custom") {
    if (!customValue) return undefined;
    const d = new Date(customValue);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const d = new Date();
  if (preset === "later") {
    d.setHours(d.getHours() + 3);
  } else if (preset === "tomorrow") {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

export function FocusDock({
  selected,
  leads,
  callerLabel,
  lineBlockReason,
  hasNext,
  onAdvance,
  onComplete
}: {
  selected: FocusLead | null;
  leads: FocusLead[];
  callerLabel: string | null;
  lineBlockReason: string | null;
  hasNext: boolean;
  onAdvance: () => void;
  onComplete: (leadId: string, summary: WrapupSummary) => void;
}) {
  const { openCallInline, call, controls } = useCall();

  // The lead the live/ended call belongs to (derived from the snapshot, so the
  // dock stays locked to the call even if the SDR browses other leads).
  const callLead = call.contactId ? leads.find((lead) => lead.id === call.contactId) ?? null : null;
  const onCall =
    Boolean(callLead) &&
    call.surface === "dock" &&
    (call.status === "connecting" || call.status === "ringing" || call.status === "in-call");
  const wrapping =
    Boolean(callLead) &&
    call.surface === "dock" &&
    (call.status === "ended" || call.status === "error" || call.status === "ringout-done");

  // Notes typed while on the call carry straight into the wrap-up (same state).
  const [notes, setNotes] = React.useState("");

  const startCall = React.useCallback(
    (lead: FocusLead) => {
      if (leadBlockReason(lead, lineBlockReason)) return;
      setNotes("");
      openCallInline(leadCallTarget(lead, callerLabel, lineBlockReason));
    },
    [callerLabel, lineBlockReason, openCallInline]
  );

  if (onCall && callLead) {
    return <LiveCall lead={callLead} call={call} controls={controls} notes={notes} setNotes={setNotes} />;
  }
  if (wrapping && callLead) {
    return (
      <Wrapup
        lead={callLead}
        call={call}
        notes={notes}
        setNotes={setNotes}
        hasNext={hasNext}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onDismiss={() => {
          controls.reset();
          setNotes("");
        }}
      />
    );
  }
  return (
    <PreCall
      lead={selected}
      callerLabel={callerLabel}
      lineBlockReason={lineBlockReason}
      onCall={startCall}
      onConsent={controls.setConsent}
      consent={call.consent}
    />
  );
}

// ─────────────────────────── Pre-call ───────────────────────────
function PreCall({
  lead,
  callerLabel,
  lineBlockReason,
  onCall,
  onConsent,
  consent
}: {
  lead: FocusLead | null;
  callerLabel: string | null;
  lineBlockReason: string | null;
  onCall: (lead: FocusLead) => void;
  onConsent: (c: "Granted" | "Denied" | "Unknown") => void;
  consent: "Granted" | "Denied" | "Unknown";
}) {
  if (!lead) {
    return <div className="p-4 text-[12px] text-co-muted">Select a lead to begin.</div>;
  }
  const block = leadBlockReason(lead, lineBlockReason);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Next best action */}
      <div className="rounded-[10px] border border-[#bcd8ff] bg-[#eaf3ff] p-3.5">
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-blue-dark">Next best action</div>
        <div className="mt-1 text-[13px] font-bold text-co-ink">
          {block ? block : lead.overdue ? "Call now — SLA overdue" : "Call now"}
        </div>
        <button
          type="button"
          disabled={Boolean(block)}
          onClick={() => onCall(lead)}
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-co-blue text-[13px] font-bold text-white transition-colors hover:bg-co-blue-hover disabled:cursor-not-allowed disabled:bg-[#dce5ee] disabled:text-co-muted-2"
        >
          <Phone className="size-4" aria-hidden="true" />
          {block ? "Call unavailable" : `Call ${lead.phone}`}
        </button>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <label htmlFor="dock-consent" className="text-[11px] font-semibold text-co-text-3">
            Recording consent
          </label>
          <select
            id="dock-consent"
            value={consent}
            onChange={(event) => onConsent(event.target.value as "Granted" | "Denied" | "Unknown")}
            className="h-7 rounded-md border border-co-control bg-white px-2 text-[11px] font-semibold text-co-ink"
          >
            <option value="Granted">Granted</option>
            <option value="Denied">Denied</option>
            <option value="Unknown">Unknown</option>
          </select>
        </div>
      </div>

      {/* Quick actions */}
      <QuickActions lead={lead} />

      {/* Call readiness */}
      <div>
        <div className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Call readiness</div>
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-co-border bg-white p-3">
          <ReadyRow ok={!lineBlockReason} label="Your line" value={callerLabel ?? lineBlockReason ?? "No line configured"} />
          <ReadyRow ok={lead.hasPhone} label="Contact phone" value={lead.hasPhone ? lead.phone : "No phone on file"} />
          <ReadyRow
            ok={lead.status !== "Suppressed" && lead.status !== "Unsubscribed"}
            label="Compliance"
            value={lead.status === "Suppressed" ? "Suppressed" : lead.status === "Unsubscribed" ? "Unsubscribed" : "Clear to contact"}
          />
          <ReadyRow
            ok={Boolean(lead.localTimeLabel) && !lead.outsideWindow}
            tone={lead.outsideWindow ? "warn" : undefined}
            label="Local time"
            value={
              lead.localTimeLabel
                ? lead.outsideWindow
                  ? `${lead.localTimeLabel} · outside window`
                  : lead.localTimeLabel
                : "Unknown"
            }
          />
          <ReadyRow ok={consent === "Granted"} label="Recording consent" value={consent} tone={consent === "Granted" ? "ok" : "warn"} />
        </div>
      </div>
    </div>
  );
}

function ReadyRow({
  ok,
  label,
  value,
  tone
}: {
  ok: boolean;
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  const dot = ok ? "bg-co-teal" : tone === "warn" ? "bg-co-amber-dot" : "bg-co-red";
  return (
    <div className="flex items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className="w-[118px] shrink-0 text-[11.5px] text-co-text-3">{label}</span>
      <span className="truncate text-[11.5px] font-semibold text-co-ink">{value}</span>
    </div>
  );
}
// ─────────────────────────── Live call ───────────────────────────
function LiveCall({
  lead,
  call,
  controls,
  notes,
  setNotes
}: {
  lead: FocusLead;
  call: ReturnType<typeof useCall>["call"];
  controls: ReturnType<typeof useCall>["controls"];
  notes: string;
  setNotes: (value: string) => void;
}) {
  const stateLabel =
    call.status === "connecting" ? "Connecting…" : call.status === "ringing" ? "Ringing…" : "Connected";
  const stateDot =
    call.status === "in-call" ? "bg-co-teal" : call.status === "ringing" ? "bg-co-blue" : "bg-co-amber-dot";
  const connected = call.status === "in-call";

  const [keypadOpen, setKeypadOpen] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const { loadTransferTargets } = controls;
  const targetCount = call.transfer.targets.length;
  function toggleTransfer() {
    setTransferOpen((open) => {
      if (!open && targetCount === 0) loadTransferTargets();
      return !open;
    });
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Navy call strip */}
      <div className="rounded-[12px] bg-[#020626] p-4 text-white">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2.5" aria-hidden="true">
            <span className={`absolute inline-flex size-full animate-ping rounded-full ${stateDot} opacity-70`} />
            <span className={`relative inline-flex size-2.5 rounded-full ${stateDot}`} />
          </span>
          <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-white/80">{stateLabel}</span>
          <span className="ml-auto font-mono text-[15px] font-bold tabular-nums">{formatClock(call.seconds)}</span>
        </div>
        <div className="mt-2.5">
          <div className="text-[15px] font-extrabold">{lead.name}</div>
          <div className="text-[12px] text-white/70">
            {[lead.companyName, call.phone].filter(Boolean).join(" · ")}
          </div>
        </div>

        {keypadOpen ? (
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {DIAL_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => controls.sendDtmf(key)}
                disabled={!connected}
                className="h-8 rounded-md bg-white/10 text-[13px] font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-40"
              >
                {key}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <StripButton onClick={controls.toggleMute} disabled={!connected} active={call.muted}>
            {call.muted ? <MicOff className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}
            {call.muted ? "Unmute" : "Mute"}
          </StripButton>
          <StripButton onClick={() => setKeypadOpen((open) => !open)} disabled={!connected} active={keypadOpen}>
            <Grid3x3 className="size-4" aria-hidden="true" />
            Keypad
          </StripButton>
          <button
            type="button"
            onClick={controls.hangup}
            disabled={call.status === "connecting"}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#e5484d] text-[12px] font-bold text-white transition-colors hover:opacity-90 disabled:opacity-40"
          >
            <PhoneOff className="size-4" aria-hidden="true" />
            {call.status === "ringing" ? "Cancel" : "Hang up"}
          </button>
        </div>

        {/* Consent + recording status */}
        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-white/55">
          <Radio className={`size-3.5 ${call.recording ? "text-[#ff9d9d]" : ""}`} aria-hidden="true" />
          <span className={call.recording ? "text-[#ff9d9d]" : ""}>{call.recording ? "Recording" : "Not recording"}</span>
          <span>· Consent {call.consent}</span>
        </div>

        {/* Transfer to manager */}
        {connected ? (
          <div className="mt-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={toggleTransfer}
              aria-expanded={transferOpen}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-white/10 text-[12px] font-bold text-white transition-colors hover:bg-white/20"
            >
              <PhoneForwarded className="size-4" aria-hidden="true" />
              Transfer to manager
            </button>
            {transferOpen ? <TransferPanel transfer={call.transfer} controls={controls} /> : null}
          </div>
        ) : null}

        {call.error ? <p className="mt-2 text-[11px] text-[#ffb4b4]">{call.error}</p> : null}
      </div>

      {/* Live notes */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">
          <StickyNote className="size-3.5" aria-hidden="true" />
          Live call notes
          <span className="ml-auto font-normal normal-case text-co-muted-2">{notes.trim() ? "Draft" : "Empty"}</span>
        </div>
        <div className="mb-1.5 flex flex-wrap gap-1">
          {NOTE_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setNotes(`${notes}${notes && !notes.endsWith("\n") ? "\n" : ""}${chip}: `)}
              className="rounded-full border border-co-control bg-white px-2 py-0.5 text-[10.5px] font-semibold text-co-text-3 hover:bg-co-sunken"
            >
              {chip}
            </button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Capture what the prospect says…"
          className="min-h-[120px] flex-1 resize-none rounded-[10px] border border-co-control bg-white p-2.5 text-[12.5px] text-co-ink placeholder:text-co-muted-2"
        />
      </div>
    </div>
  );
}

function StripButton({
  onClick,
  disabled,
  active,
  children
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold text-white transition-colors disabled:opacity-40 ${
        active ? "bg-white/25" : "bg-white/10 hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

function TransferPanel({
  transfer,
  controls
}: {
  transfer: ReturnType<typeof useCall>["call"]["transfer"];
  controls: ReturnType<typeof useCall>["controls"];
}) {
  return (
    <div className="mt-2 rounded-[10px] bg-white p-2.5 text-co-ink">
      {transfer.loading ? (
        <div className="flex items-center gap-2 text-[12px] text-co-text-3">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading manager RingCentral lines…
        </div>
      ) : transfer.targets.length ? (
        <div className="flex flex-col gap-0.5">
          {transfer.targets.map((target) => (
            <label
              key={target.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-co-sunken"
            >
              <input
                type="radio"
                name="dock-transfer-target"
                checked={transfer.selectedId === target.id}
                onChange={() => controls.selectTransferTarget(target.id)}
              />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold">
                  {target.name} · {target.role}
                </span>
                <span className="block truncate text-[11px] text-co-muted-2">RingCentral · {target.phoneNumber}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-[11.5px] text-co-muted-2">No manager RingCentral line configured.</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <input
          value={transfer.number}
          onChange={(event) => controls.setTransferNumber(event.target.value)}
          inputMode="tel"
          placeholder="+1 (___) ___-____"
          aria-label="Transfer number"
          className="h-8 min-w-0 flex-1 rounded-md border border-co-control px-2 text-[12px] text-co-ink"
        />
        <button
          type="button"
          onClick={controls.transferCall}
          disabled={transfer.pending || !transfer.number.trim()}
          className="h-8 rounded-md bg-co-blue px-3 text-[12px] font-bold text-white transition-colors hover:bg-co-blue-hover disabled:bg-[#dce5ee] disabled:text-co-muted-2"
        >
          {transfer.pending ? "Transferring…" : "Transfer"}
        </button>
      </div>
      {transfer.error ? <p className="mt-1.5 text-[11px] text-co-red-text">{transfer.error}</p> : null}
      {transfer.message ? <p className="mt-1.5 text-[11px] text-co-teal-text">{transfer.message}</p> : null}
    </div>
  );
}

// ─────────────────────────── Wrap-up ───────────────────────────
function Wrapup({
  lead,
  call,
  notes,
  setNotes,
  hasNext,
  onAdvance,
  onComplete,
  onDismiss
}: {
  lead: FocusLead;
  call: ReturnType<typeof useCall>["call"];
  notes: string;
  setNotes: (value: string) => void;
  hasNext: boolean;
  onAdvance: () => void;
  onComplete: (leadId: string, summary: WrapupSummary) => void;
  onDismiss: () => void;
}) {
  const connected = call.seconds > 0 && call.status !== "error";
  const [outcome, setOutcome] = React.useState<string>(connected ? "Connected" : "No answer");
  const def = OUTCOMES.find((item) => item.id === outcome) ?? OUTCOMES[0];
  const [status, setStatus] = React.useState<string>(def.status);
  const [followUp, setFollowUp] = React.useState<FollowUpPreset>(def.followUp ?? "none");
  const [customFollowUp, setCustomFollowUp] = React.useState("");
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [taskTitle, setTaskTitle] = React.useState("");
  const [taskDue, setTaskDue] = React.useState("");
  const [oppOpen, setOppOpen] = React.useState(Boolean(def.opp));
  const [oppName, setOppName] = React.useState(`${lead.companyName} opportunity`);
  const [oppStage, setOppStage] = React.useState("Qualified");
  const [oppAmount, setOppAmount] = React.useState("");
  const [oppClose, setOppClose] = React.useState("");
  const [oppNextStep, setOppNextStep] = React.useState("");
  const [meetingAt, setMeetingAt] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState<string[] | null>(null);

  // Selecting an outcome pulls the honest default status + side-effects.
  function pickOutcome(next: string) {
    setOutcome(next);
    const nextDef = OUTCOMES.find((item) => item.id === next);
    if (!nextDef) return;
    setStatus(nextDef.status);
    if (nextDef.followUp) setFollowUp(nextDef.followUp);
    if (nextDef.opp) setOppOpen(true);
    if (nextDef.meeting) setFollowUp("custom");
  }

  async function save(advance: boolean) {
    if (pending) return;
    setPending(true);
    const followUpDueAt =
      def.meeting && meetingAt
        ? new Date(meetingAt).toISOString()
        : presetToIso(followUp, customFollowUp);
    const result = await saveCallWrapupAction({
      assignmentId: lead.assignmentId,
      contactId: lead.id,
      companyId: lead.companyId,
      outcome,
      leadStatus: status,
      notes,
      followUpDueAt,
      task: taskOpen && taskTitle.trim() ? { title: taskTitle.trim(), dueAt: taskDue || undefined } : null,
      opportunity:
        oppOpen && oppName.trim()
          ? {
              name: oppName.trim(),
              stage: oppStage,
              amount: oppAmount ? Number(oppAmount) : undefined,
              expectedCloseDate: oppClose || undefined,
              nextStep: oppNextStep.trim() || undefined
            }
          : null
    });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onComplete(lead.id, {
      connected,
      followUp: Boolean(followUpDueAt),
      opp: Boolean(oppOpen && oppName.trim())
    });
    toast.success("Wrap-up saved.");
    if (advance) {
      setSaved(result.created);
    } else {
      onDismiss();
    }
  }

  // ⌘/Ctrl+Enter = Save & next lead (the footer hint). Uses a ref so the listener
  // never goes stale without rebinding every render.
  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  });
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void saveRef.current(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (saved) {
    return <Success created={saved} name={lead.name} hasNext={hasNext} onAdvance={onAdvance} onStay={onDismiss} />;
  }

  const chip = (active: boolean) =>
    `rounded-lg border px-2.5 py-2 text-[12px] font-bold transition-colors ${
      active ? "border-co-blue bg-co-blue text-white" : "border-co-control bg-white text-co-text-3 hover:bg-co-sunken"
    }`;
  const field = "h-8 w-full rounded-md border border-co-control bg-white px-2 text-[12px] text-co-ink";

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 [&>*]:shrink-0">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Call wrap-up</div>
          <div className="text-[14px] font-extrabold text-co-ink">{lead.name}</div>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Discard wrap-up" className="text-co-muted hover:text-co-ink">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {call.status === "error" ? (
        <div className="mt-2 rounded-[10px] border border-[#f5b5b5] bg-co-red-bg-soft px-3 py-2 text-[11.5px] text-co-red-text">
          <span className="font-extrabold">Call failed.</span> {call.error || "The call couldn't connect."} Pick the outcome
          below, or retry from the dossier.
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <CoPill tone={connected ? "teal" : "neutral"}>{connected ? `Connected · ${formatClock(call.seconds)}` : "Not connected"}</CoPill>
        <CoPill tone={call.recording ? "red" : "neutral"}>{call.recording ? "Recorded" : "Not recorded"}</CoPill>
        <CoPill tone="neutral">Consent {call.consent}</CoPill>
      </div>

      {/* Outcome */}
      <div className="mt-3 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Outcome</div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {OUTCOMES.map((item) => (
          <button key={item.id} type="button" onClick={() => pickOutcome(item.id)} className={chip(outcome === item.id)}>
            {item.id}
          </button>
        ))}
      </div>

      {/* Notes */}
      <div className="mt-3 flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">
        Notes
        <span className="ml-auto font-normal normal-case text-co-muted-2">{notes.trim() ? "Draft" : "Empty"}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {NOTE_CHIPS.map((chipLabel) => (
          <button
            key={chipLabel}
            type="button"
            onClick={() => setNotes(`${notes}${notes && !notes.endsWith("\n") ? "\n" : ""}${chipLabel}: `)}
            className="rounded-full border border-co-control bg-white px-2 py-0.5 text-[10.5px] font-semibold text-co-text-3 hover:bg-co-sunken"
          >
            {chipLabel}
          </button>
        ))}
      </div>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={4}
        placeholder="What happened on the call…"
        className="mt-1.5 min-h-[104px] w-full resize-y rounded-[10px] border border-co-control bg-white p-2.5 text-[12.5px] text-co-ink placeholder:text-co-muted-2"
      />

      {/* Lead status + suggested next action */}
      <div className="mt-3 grid grid-cols-[118px_1fr] items-center gap-2">
        <span className="text-[11.5px] font-semibold text-co-text-3">Lead status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className={field}>
          {LEAD_STATUSES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-1.5 grid grid-cols-[118px_1fr] items-center gap-2">
        <span className="text-[11.5px] font-semibold text-co-text-3">Next action</span>
        <span className="rounded-md bg-[#eaf3ff] px-2 py-1.5 text-[11.5px] font-semibold text-co-blue-dark">
          {def.nextAction}
        </span>
      </div>

      {/* Follow-up */}
      <div className="mt-3 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">
        Follow-up <span className="font-normal normal-case text-co-muted-2">· creates the reminder + task</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFollowUp("none")} className={chip(followUp === "none")}>
          None
        </button>
        {FOLLOWUP_PRESETS.map((preset) => (
          <button key={preset.id} type="button" onClick={() => setFollowUp(preset.id)} className={chip(followUp === preset.id)}>
            {preset.label}
          </button>
        ))}
      </div>
      {followUp === "custom" && !def.meeting ? (
        <input
          type="datetime-local"
          value={customFollowUp}
          onChange={(event) => setCustomFollowUp(event.target.value)}
          className={`${field} mt-1.5`}
        />
      ) : null}

      {/* Meeting booked honesty panel */}
      {def.meeting ? (
        <div className="mt-3 rounded-[10px] border border-[#bdf0e4] bg-[#ecfdf8] p-3">
          <div className="text-[11.5px] font-bold text-[#0b7c6c]">What saves when you book this meeting</div>
          <ul className="mt-1 list-disc pl-4 text-[11.5px] text-co-text-2">
            <li>Status → Meeting Booked</li>
            <li>Follow-up reminder at the agreed time</li>
            <li>Details in the call note</li>
          </ul>
          <input
            type="datetime-local"
            value={meetingAt}
            onChange={(event) => setMeetingAt(event.target.value)}
            className={`${field} mt-2`}
            aria-label="Meeting time"
          />
          <p className="mt-2 text-[11px] text-[#8a5a06]">
            Calendar event creation and attendee invitations require future calendar integration — not part of this release.
          </p>
        </div>
      ) : null}

      {/* Collapsible task */}
      <Collapsible open={taskOpen} onToggle={() => setTaskOpen((v) => !v)} label="Task">
        <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task title" className={field} />
        <input type="datetime-local" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className={`${field} mt-1.5`} />
      </Collapsible>

      {/* Collapsible opportunity */}
      <Collapsible open={oppOpen} onToggle={() => setOppOpen((v) => !v)} label="Opportunity">
        <div className="mb-1.5 text-[10.5px] text-co-muted-2">
          {[lead.companyName, lead.name, `Owner ${lead.owner}`].filter(Boolean).join(" · ")}
        </div>
        <input value={oppName} onChange={(e) => setOppName(e.target.value)} placeholder="Opportunity name" className={field} />
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <select value={oppStage} onChange={(e) => setOppStage(e.target.value)} className={field}>
            {OPP_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
          <input
            value={oppAmount}
            onChange={(e) => setOppAmount(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="Amount"
            className={field}
          />
        </div>
        <input type="date" value={oppClose} onChange={(e) => setOppClose(e.target.value)} className={`${field} mt-1.5`} />
        <input
          value={oppNextStep}
          onChange={(e) => setOppNextStep(e.target.value)}
          placeholder="Next step"
          className={`${field} mt-1.5`}
        />
        <p className="mt-1.5 text-[10.5px] text-co-muted-2">Probability auto-maps to the stage.</p>
      </Collapsible>

      {/* Footer */}
      <div className="mt-4 border-t border-co-border pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => save(true)}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-co-blue text-[13px] font-bold text-white transition-colors hover:bg-co-blue-hover disabled:bg-[#dce5ee] disabled:text-co-muted-2"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Save &amp; next lead
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => save(false)}
            className="h-10 rounded-lg border border-co-control bg-white px-3 text-[12.5px] font-semibold text-co-text-3 hover:bg-co-sunken disabled:opacity-50"
          >
            Save &amp; stay
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              onDismiss();
              onAdvance();
            }}
            className="h-8 rounded-md border border-co-control bg-white px-3 text-[12px] font-semibold text-co-text-3 hover:bg-co-sunken disabled:opacity-50"
          >
            Skip
          </button>
          <a
            href="/sdr/queue"
            className="flex h-8 items-center rounded-md border border-co-control bg-white px-3 text-[12px] font-semibold text-co-text-3 hover:bg-co-sunken"
          >
            Queue
          </a>
          <span className="ml-auto text-[10.5px] text-co-muted-2">⌘↵ save &amp; next</span>
        </div>
      </div>
    </div>
  );
}

function Collapsible({
  open,
  onToggle,
  label,
  children
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 text-[11.5px] font-bold text-co-blue-dark"
      >
        <span className="text-[13px] leading-none">{open ? "−" : "+"}</span>
        {label}
      </button>
      {open ? <div className="mt-1.5 rounded-[10px] border border-co-border bg-co-sunken p-2.5">{children}</div> : null}
    </div>
  );
}

// ─────────────────────────── Success ───────────────────────────
function Success({
  created,
  name,
  hasNext,
  onAdvance,
  onStay
}: {
  created: string[];
  name: string;
  hasNext: boolean;
  onAdvance: () => void;
  onStay: () => void;
}) {
  // Auto-advance after a short beat (only when there IS a next lead); the SDR can
  // stay to stop it.
  const advanceRef = React.useRef(onAdvance);
  React.useEffect(() => {
    advanceRef.current = onAdvance;
  });
  React.useEffect(() => {
    if (!hasNext) return;
    const timer = setTimeout(() => advanceRef.current(), 1600);
    return () => clearTimeout(timer);
  }, [hasNext]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="rounded-[12px] border border-[#bdf0e4] bg-[#ecfdf8] p-4">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-co-teal text-white">
            <Check className="size-4" aria-hidden="true" />
          </span>
          <span className="text-[14px] font-extrabold text-[#0b7c6c]">Saved — {name}</span>
        </div>
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {created.map((item) => (
            <li key={item} className="flex items-center gap-1.5 text-[12px] text-co-text-2">
              <Circle className="size-3 fill-co-teal text-co-teal" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>
      {hasNext ? (
        <div className="rounded-[10px] border border-co-border bg-white p-3">
          <div className="text-[12px] font-semibold text-co-text-3">Advancing to next lead…</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-co-sunken-2">
            <div className="h-full animate-[co-bar_1.6s_linear] rounded-full bg-co-blue" style={{ width: "100%" }} />
          </div>
          <button
            type="button"
            onClick={onStay}
            className="mt-2.5 h-8 w-full rounded-md border border-co-control bg-white text-[12px] font-semibold text-co-text-3 hover:bg-co-sunken"
          >
            Stay on this lead
          </button>
        </div>
      ) : (
        <div className="rounded-[10px] border border-co-border bg-white p-4 text-center">
          <div className="text-[13px] font-extrabold text-co-ink">Queue complete</div>
          <p className="mt-1 text-[12px] text-co-text-3">
            You&apos;ve worked every lead in this view. Nice work — end the session or head back to My Day.
          </p>
          <div className="mt-3 flex gap-2">
            <a
              href="/sdr/queue"
              className="flex h-9 flex-1 items-center justify-center rounded-lg bg-co-blue text-[12.5px] font-bold text-white transition-colors hover:bg-co-blue-hover"
            >
              Back to My Day
            </a>
            <button
              type="button"
              onClick={onStay}
              className="h-9 rounded-lg border border-co-control bg-white px-3 text-[12.5px] font-semibold text-co-text-3 hover:bg-co-sunken"
            >
              Stay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
