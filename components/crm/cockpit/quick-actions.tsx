"use client";

import * as React from "react";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";

import {
  createNoteAction,
  createTaskAction,
  logFirstTouchAction,
  sendDirectEmailAction,
  sendDirectSmsAction
} from "@/app/actions";
import type { FocusLead } from "@/components/crm/cockpit/focus/focus-types";

// Shared SDR quick-action grid + inline panels (1:1 Email / SMS, Add note,
// Follow-up, Create task, Log touch). Used by the Focus dock's pre-call panel and
// the standalone contact page's action rail, so both offer the same actions.
type QuickAction = "email" | "sms" | "note" | "followup" | "task" | "touch" | null;

export function QuickActions({ lead, showLabel = true }: { lead: FocusLead; showLabel?: boolean }) {
  const [panel, setPanel] = React.useState<QuickAction>(null);
  const actions: Array<{ id: Exclude<QuickAction, null>; label: string; disabled: boolean }> = [
    { id: "email", label: "1:1 Email", disabled: !lead.emailEligible },
    { id: "sms", label: "1:1 SMS", disabled: !lead.hasPhone },
    { id: "note", label: "Add note", disabled: false },
    { id: "followup", label: "Follow-up", disabled: false },
    { id: "task", label: "Create task", disabled: false },
    // Log touch records against the SDR assignment; disabled when there isn't one.
    { id: "touch", label: "Log touch", disabled: !lead.assignmentId }
  ];

  return (
    <div>
      {showLabel ? (
        <div className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Quick actions</div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={action.disabled}
            onClick={() => setPanel((current) => (current === action.id ? null : action.id))}
            aria-pressed={panel === action.id}
            className={`h-9 rounded-lg border text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:text-co-muted-2 ${
              panel === action.id
                ? "border-co-blue bg-co-accent-bg text-co-blue-dark"
                : "border-co-control bg-co-surface text-co-text-3 hover:bg-co-sunken"
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
      {panel ? <QuickPanel action={panel} lead={lead} onClose={() => setPanel(null)} /> : null}
    </div>
  );
}

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
  const [files, setFiles] = React.useState<File[]>([]);

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
    "h-8 w-full rounded-md border border-co-control bg-co-surface px-2 text-[12px] text-co-ink placeholder:text-co-muted-2";
  const area = "w-full rounded-md border border-co-control bg-co-surface px-2 py-1.5 text-[12px] text-co-ink placeholder:text-co-muted-2";
  const submit =
    "h-8 rounded-md bg-co-blue px-3 text-[12px] font-bold text-white transition-colors hover:bg-co-blue-hover disabled:bg-co-disabled-bg disabled:text-co-muted-2";

  if (action === "email") {
    return (
      <div className={wrap}>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={field} />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={12}
          placeholder="Message… ({{first_name}}, {{company}})"
          className={`${area} mt-2 min-h-[220px] resize-y`}
        />
        {/* Attachments */}
        <div className="mt-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-co-control bg-co-surface px-2.5 text-[12px] font-semibold text-co-text-3 hover:bg-co-sunken">
            <Paperclip className="size-3.5" aria-hidden="true" />
            Attach files
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
            />
          </label>
          {files.length ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-md bg-co-surface px-2 py-1 text-[11.5px] text-co-text-2"
                >
                  <span className="truncate">
                    {file.name} <span className="text-co-muted-2">({Math.max(1, Math.round(file.size / 1024))} KB)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove ${file.name}`}
                    className="shrink-0 text-co-muted-2 hover:text-co-red-text"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
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
                  for (const file of files) f.append("attachments", file);
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
      className="h-8 rounded-md border border-co-control bg-co-surface px-3 text-[12px] font-semibold text-co-text-3 hover:bg-co-sunken"
    >
      Cancel
    </button>
  );
}
