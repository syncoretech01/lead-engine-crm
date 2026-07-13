"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Check,
  Circle,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  StickyNote,
  X
} from "lucide-react";

import {
  createNoteAction,
  createTaskAction,
  logFirstTouchAction,
  saveCallWrapupAction,
  sendDirectEmailAction,
  sendDirectSmsAction
} from "@/app/actions";
import { useCall } from "@/components/call/call-context";
import { CoPill } from "@/components/crm/cockpit/co-table";
import { leadBlockReason, leadCallTarget, type FocusLead } from "@/components/crm/cockpit/focus/focus-types";

const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

// Disposition → default lead status + side-effects (README §70). The SDR can
// override the status in the wrap-up; these are the honest defaults.
type OutcomeDef = {
  id: string;
  status: string;
  followUp?: FollowUpPreset;
  opp?: boolean;
  meeting?: boolean;
};
const OUTCOMES: OutcomeDef[] = [
  { id: "Connected", status: "Contacted" },
  { id: "No answer", status: "Working" },
  { id: "Voicemail", status: "Contacted" },
  { id: "Busy", status: "Working" },
  { id: "Wrong number", status: "Invalid" },
  { id: "Not interested", status: "Disqualified" },
  { id: "Follow-up required", status: "Working", followUp: "tomorrow" },
  { id: "Qualified", status: "Qualified", opp: true },
  { id: "Meeting booked", status: "Meeting Booked", meeting: true },
  { id: "Do not contact", status: "Suppressed" }
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

type FollowUpPreset = "later" | "tomorrow" | "nextbiz" | "3days" | "nextweek" | "custom" | "none";
const FOLLOWUP_PRESETS: Array<{ id: FollowUpPreset; label: string }> = [
  { id: "later", label: "Later today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "nextbiz", label: "Next business day" },
  { id: "3days", label: "In 3 days" },
  { id: "nextweek", label: "Next week" },
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
  } else if (preset === "nextbiz") {
    do {
      d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    d.setHours(9, 0, 0, 0);
  } else if (preset === "3days") {
    d.setDate(d.getDate() + 3);
    d.setHours(9, 0, 0, 0);
  } else if (preset === "nextweek") {
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

export function FocusDock({
  selected,
  leads,
  callerLabel,
  lineBlockReason,
  onAdvance,
  onComplete
}: {
  selected: FocusLead | null;
  leads: FocusLead[];
  callerLabel: string | null;
  lineBlockReason: string | null;
  onAdvance: () => void;
  onComplete: (leadId: string) => void;
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
type QuickAction = "email" | "sms" | "note" | "followup" | "task" | "touch" | null;

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
  const [panel, setPanel] = React.useState<QuickAction>(null);
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
      <div>
        <div className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Quick actions</div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: "email", label: "1:1 Email", disabled: !lead.emailEligible },
              { id: "sms", label: "1:1 SMS", disabled: !lead.hasPhone },
              { id: "note", label: "Add note", disabled: false },
              { id: "followup", label: "Follow-up", disabled: false },
              { id: "task", label: "Create task", disabled: false },
              { id: "touch", label: "Log touch", disabled: false }
            ] as Array<{ id: Exclude<QuickAction, null>; label: string; disabled: boolean }>
          ).map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={action.disabled}
              onClick={() => setPanel((current) => (current === action.id ? null : action.id))}
              aria-pressed={panel === action.id}
              className={`h-9 rounded-lg border text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:text-co-muted-2 ${
                panel === action.id
                  ? "border-co-blue bg-[#eaf3ff] text-co-blue-dark"
                  : "border-co-control bg-white text-co-text-3 hover:bg-co-sunken"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
        {panel ? <QuickPanel action={panel} lead={lead} onClose={() => setPanel(null)} /> : null}
      </div>

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

// ─────────────────────────── Quick-action panels ───────────────────────────
function QuickPanel({
  action,
  lead,
  onClose
}: {
  action: Exclude<QuickAction, null>;
  lead: FocusLead;
  onClose: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [subject, setSubject] = React.useState("Quick question");
  const [message, setMessage] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");

  async function run(build: () => FormData, act: (form: FormData) => Promise<unknown>, success: string) {
    if (pending) return;
    setPending(true);
    try {
      await act(build());
      toast.success(success);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const wrap = "mt-2 rounded-[10px] border border-co-border bg-co-sunken p-3";
  const field =
    "h-8 w-full rounded-md border border-co-control bg-white px-2 text-[12px] text-co-ink placeholder:text-co-muted-2";
  const area = "w-full rounded-md border border-co-control bg-white px-2 py-1.5 text-[12px] text-co-ink placeholder:text-co-muted-2";
  const submit =
    "h-8 rounded-md bg-co-blue px-3 text-[12px] font-bold text-white transition-colors hover:bg-co-blue-hover disabled:bg-[#dce5ee] disabled:text-co-muted-2";

  if (action === "email") {
    return (
      <div className={wrap}>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={field} />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Message… ({{first_name}}, {{company}})"
          className={`${area} mt-2`}
        />
        <div className="mt-2 flex justify-end gap-2">
          <PanelCancel onClose={onClose} />
          <button
            type="button"
            disabled={pending}
            className={submit}
            onClick={() =>
              run(
                () => {
                  const f = new FormData();
                  f.set("contactId", lead.id);
                  f.set("subject", subject);
                  f.set("bodySnapshot", message || "Hi {{first_name}}, quick question about {{company}}.");
                  return f;
                },
                sendDirectEmailAction,
                "Email sent."
              )
            }
          >
            {pending ? "Sending…" : "Send email"}
          </button>
        </div>
      </div>
    );
  }
  if (action === "sms") {
    return (
      <div className={wrap}>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Text message…"
          className={area}
        />
        <div className="mt-2 flex justify-end gap-2">
          <PanelCancel onClose={onClose} />
          <button
            type="button"
            disabled={pending || !message.trim()}
            className={submit}
            onClick={() =>
              run(
                () => {
                  const f = new FormData();
                  f.set("contactId", lead.id);
                  f.set("body", message);
                  return f;
                },
                sendDirectSmsAction,
                "Text sent."
              )
            }
          >
            {pending ? "Sending…" : "Send text"}
          </button>
        </div>
      </div>
    );
  }
  if (action === "note") {
    return (
      <div className={wrap}>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Note…" className={area} />
        <div className="mt-2 flex justify-end gap-2">
          <PanelCancel onClose={onClose} />
          <button
            type="button"
            disabled={pending || !message.trim()}
            className={submit}
            onClick={() =>
              run(
                () => {
                  const f = new FormData();
                  f.set("contactId", lead.id);
                  f.set("companyId", lead.companyId);
                  f.set("title", "Note");
                  f.set("body", message);
                  return f;
                },
                createNoteAction,
                "Note added."
              )
            }
          >
            {pending ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    );
  }
  if (action === "task" || action === "followup") {
    const isFollow = action === "followup";
    return (
      <div className={wrap}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isFollow ? "Follow up with…" : "Task title"}
          className={field}
        />
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={`${field} mt-2`} />
        <div className="mt-2 flex justify-end gap-2">
          <PanelCancel onClose={onClose} />
          <button
            type="button"
            disabled={pending}
            className={submit}
            onClick={() =>
              run(
                () => {
                  const f = new FormData();
                  f.set("contactId", lead.id);
                  f.set("companyId", lead.companyId);
                  f.set("title", title.trim() || (isFollow ? `Follow up with ${lead.name}` : "Follow up"));
                  if (due) f.set("dueAt", due);
                  return f;
                },
                createTaskAction,
                isFollow ? "Follow-up scheduled." : "Task created."
              )
            }
          >
            {pending ? "Saving…" : isFollow ? "Schedule" : "Create task"}
          </button>
        </div>
      </div>
    );
  }
  // Log touch — a manual (non-call) touch on the assignment.
  return (
    <div className={wrap}>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        placeholder="What happened on this touch?"
        className={area}
      />
      <div className="mt-2 flex justify-end gap-2">
        <PanelCancel onClose={onClose} />
        <button
          type="button"
          disabled={pending}
          className={submit}
          onClick={() =>
            run(
              () => {
                const f = new FormData();
                f.set("assignmentId", lead.assignmentId);
                f.set("channel", "Call");
                f.set("outcome", lead.status || "Contacted");
                f.set("notes", message.trim() || "Manual touch logged.");
                return f;
              },
              logFirstTouchAction,
              "Touch logged."
            )
          }
        >
          {pending ? "Logging…" : "Log touch"}
        </button>
      </div>
    </div>
  );
}

function PanelCancel({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="h-8 rounded-md border border-co-control bg-white px-3 text-[12px] font-semibold text-co-text-3 hover:bg-co-sunken"
    >
      Cancel
    </button>
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

        <div className="mt-3 grid grid-cols-6 gap-1.5">
          {DIAL_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => controls.sendDtmf(key)}
              disabled={call.status !== "in-call"}
              className="h-8 rounded-md bg-white/10 text-[13px] font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              {key}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={controls.toggleMute}
            disabled={call.status !== "in-call"}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 text-[12px] font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-40"
          >
            {call.muted ? <MicOff className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}
            {call.muted ? "Unmute" : "Mute"}
          </button>
          <div
            className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold ${
              call.recording ? "bg-[#e5484d] text-white" : "bg-white/10 text-white/70"
            }`}
            title={call.recording ? "Recording" : "Not recording"}
          >
            <Radio className="size-4" aria-hidden="true" />
            {call.recording ? "Rec" : "Off"}
          </div>
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

// ─────────────────────────── Wrap-up ───────────────────────────
function Wrapup({
  lead,
  call,
  notes,
  setNotes,
  onAdvance,
  onComplete,
  onDismiss
}: {
  lead: FocusLead;
  call: ReturnType<typeof useCall>["call"];
  notes: string;
  setNotes: (value: string) => void;
  onAdvance: () => void;
  onComplete: (leadId: string) => void;
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
              expectedCloseDate: oppClose || undefined
            }
          : null
    });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onComplete(lead.id);
    toast.success("Wrap-up saved.");
    if (advance) {
      setSaved(result.created);
    } else {
      onDismiss();
    }
  }

  if (saved) {
    return <Success created={saved} name={lead.name} onAdvance={onAdvance} onStay={onDismiss} />;
  }

  const chip = (active: boolean) =>
    `rounded-lg border px-2.5 py-2 text-[12px] font-bold transition-colors ${
      active ? "border-co-blue bg-co-blue text-white" : "border-co-control bg-white text-co-text-3 hover:bg-co-sunken"
    }`;
  const field = "h-8 w-full rounded-md border border-co-control bg-white px-2 text-[12px] text-co-ink";

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Call wrap-up</div>
          <div className="text-[14px] font-extrabold text-co-ink">{lead.name}</div>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Discard wrap-up" className="text-co-muted hover:text-co-ink">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

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
      <div className="mt-3 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Notes</div>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={3}
        placeholder="What happened on the call…"
        className="mt-1.5 w-full resize-none rounded-[10px] border border-co-control bg-white p-2.5 text-[12.5px] text-co-ink placeholder:text-co-muted-2"
      />

      {/* Lead status */}
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
      </Collapsible>

      {/* Footer */}
      <div className="mt-4 flex items-center gap-2 border-t border-co-border pt-3">
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
  onAdvance,
  onStay
}: {
  created: string[];
  name: string;
  onAdvance: () => void;
  onStay: () => void;
}) {
  // Auto-advance after a short beat; the SDR can stay to stop it.
  const advanceRef = React.useRef(onAdvance);
  React.useEffect(() => {
    advanceRef.current = onAdvance;
  });
  React.useEffect(() => {
    const timer = setTimeout(() => advanceRef.current(), 1600);
    return () => clearTimeout(timer);
  }, []);

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
    </div>
  );
}
