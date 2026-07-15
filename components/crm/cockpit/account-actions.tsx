"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  createCallLogAction,
  createNoteAction,
  createOpportunityAction,
  createTaskAction
} from "@/app/actions";

// Shared SDR account action rail + inline panels (Add task, Add opportunity, Add
// note, Log call) — the account-scoped mirror of the contact page's QuickActions,
// so both record pages offer the same "act without leaving the record" surface.

export type AccountActionContact = { id: string; name: string; phone: string };
type AccountAction = "task" | "opportunity" | "note" | "call" | null;

export function AccountActions({
  accountId,
  accountName,
  source,
  contacts,
  stages,
  outcomes,
  showLabel = true
}: {
  accountId: string;
  accountName: string;
  source: string;
  contacts: AccountActionContact[];
  stages: readonly string[];
  outcomes: readonly string[];
  showLabel?: boolean;
}) {
  const [panel, setPanel] = React.useState<AccountAction>(null);
  const actions: Array<{ id: Exclude<AccountAction, null>; label: string }> = [
    { id: "task", label: "Add task" },
    { id: "opportunity", label: "Add opportunity" },
    { id: "note", label: "Add note" },
    { id: "call", label: "Log call" }
  ];

  return (
    <div>
      {showLabel ? (
        <div className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Account actions</div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => setPanel((current) => (current === action.id ? null : action.id))}
            aria-pressed={panel === action.id}
            className={`h-9 rounded-lg border text-[12px] font-semibold transition-colors ${
              panel === action.id
                ? "border-co-blue bg-co-accent-bg text-co-blue-dark"
                : "border-co-control bg-co-surface text-co-text-3 hover:bg-co-sunken"
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
      {panel ? (
        <AccountPanel
          action={panel}
          accountId={accountId}
          accountName={accountName}
          source={source}
          contacts={contacts}
          stages={stages}
          outcomes={outcomes}
          onClose={() => setPanel(null)}
        />
      ) : null}
    </div>
  );
}

function AccountPanel({
  action,
  accountId,
  accountName,
  source,
  contacts,
  stages,
  outcomes,
  onClose
}: {
  action: Exclude<AccountAction, null>;
  accountId: string;
  accountName: string;
  source: string;
  contacts: AccountActionContact[];
  stages: readonly string[];
  outcomes: readonly string[];
  onClose: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [contactId, setContactId] = React.useState(contacts[0]?.id ?? "");
  // Opportunity fields
  const [oppName, setOppName] = React.useState(`${accountName} expansion`);
  const [stage, setStage] = React.useState(stages[0] ?? "Prospecting");
  const [amount, setAmount] = React.useState("25000");
  const [closeDate, setCloseDate] = React.useState("");
  // Call fields
  const [outcome, setOutcome] = React.useState(outcomes[0] ?? "Connected");
  const [minutes, setMinutes] = React.useState("5");

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

  const contactSelect = (label: string, allowNone: boolean) => (
    <label className="mt-2 block">
      <span className="mb-1 block text-[11px] font-bold text-co-muted">{label}</span>
      <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={field}>
        {allowNone ? <option value="">Account-level</option> : null}
        {contacts.map((contact) => (
          <option key={contact.id} value={contact.id}>
            {contact.name}
          </option>
        ))}
      </select>
    </label>
  );

  if (action === "task") {
    return (
      <div className={wrap}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className={field} />
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={`${field} mt-2`} />
        {contacts.length ? contactSelect("Contact (optional)", true) : null}
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
                  f.set("companyId", accountId);
                  if (contactId) f.set("contactId", contactId);
                  f.set("title", title.trim() || "Follow up");
                  if (due) f.set("dueAt", due);
                  return f;
                },
                createTaskAction,
                "Task created."
              )
            }
          >
            {pending ? "Saving…" : "Add task"}
          </button>
        </div>
      </div>
    );
  }

  if (action === "opportunity") {
    return (
      <div className={wrap}>
        <input value={oppName} onChange={(e) => setOppName(e.target.value)} placeholder="Opportunity name" className={field} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-co-muted">Stage</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={field}>
              {stages.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-co-muted">Amount</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="500" className={field} />
          </label>
        </div>
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] font-bold text-co-muted">Expected close</span>
          <input value={closeDate} onChange={(e) => setCloseDate(e.target.value)} type="date" className={field} />
        </label>
        {contacts.length ? contactSelect("Primary contact", true) : null}
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
                  f.set("companyId", accountId);
                  if (contactId) f.set("contactId", contactId);
                  f.set("name", oppName.trim() || `${accountName} opportunity`);
                  f.set("stage", stage);
                  f.set("amount", amount || "0");
                  if (closeDate) f.set("expectedCloseDate", closeDate);
                  f.set("source", source);
                  return f;
                },
                createOpportunityAction,
                "Opportunity created."
              )
            }
          >
            {pending ? "Saving…" : "Add opportunity"}
          </button>
        </div>
      </div>
    );
  }

  if (action === "note") {
    return (
      <div className={wrap}>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Account note…" className={area} />
        {contacts.length ? contactSelect("Note contact (optional)", true) : null}
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
                  f.set("companyId", accountId);
                  if (contactId) f.set("contactId", contactId);
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

  // Log call
  return (
    <div className={wrap}>
      {contacts.length ? contactSelect("Call contact", false) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-co-muted">Outcome</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={field}>
            {outcomes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-co-muted">Minutes</span>
          <input value={minutes} onChange={(e) => setMinutes(e.target.value)} type="number" min="0" step="1" className={field} />
        </label>
      </div>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="Call notes…" className={`${area} mt-2`} />
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
                f.set("companyId", accountId);
                if (contactId) f.set("contactId", contactId);
                f.set("outcome", outcome);
                f.set("durationMinutes", minutes || "0");
                f.set("notes", message.trim() || "Manual call logged.");
                return f;
              },
              createCallLogAction,
              "Call logged."
            )
          }
        >
          {pending ? "Logging…" : "Log call"}
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
