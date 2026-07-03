"use client";

import * as React from "react";
import Link from "next/link";
import { Delete, Loader2, Phone, PhoneCall, PhoneOff } from "lucide-react";

import { placeCallAction } from "@/app/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { fieldClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type CallButtonProps = {
  contactId: string;
  contactName: string;
  phone?: string;
  /** The SDR's own RingCentral line label, e.g. "Ari Patel · +13035550142". */
  callerLabel?: string;
  /** When set, calling is disabled and this reason is shown as a tooltip. */
  blockReason?: string;
  label?: string;
  iconOnly?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
};

type Phase = "idle" | "placing" | "live" | "done" | "error";
type LiveState = "initiated" | "ringing" | "connected" | "completed" | "failed";

const CONSENTS = ["Granted", "Denied", "Unknown"] as const;
const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export function CallButton({
  contactId,
  contactName,
  phone,
  callerLabel,
  blockReason,
  label = "Call",
  iconOnly = false,
  variant = "outline",
  size = "sm",
  className
}: CallButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [number, setNumber] = React.useState(phone ?? "");
  const [consent, setConsent] = React.useState<(typeof CONSENTS)[number]>("Granted");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [liveState, setLiveState] = React.useState<LiveState>("initiated");
  const [error, setError] = React.useState<string | null>(null);
  const [callId, setCallId] = React.useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const disabled = Boolean(blockReason) || !phone;

  const stopPolling = React.useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  React.useEffect(() => stopPolling, [stopPolling]);

  function reset() {
    stopPolling();
    setPhase("idle");
    setLiveState("initiated");
    setError(null);
    setCallId(null);
    setNumber(phone ?? "");
  }

  function onOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  function poll(id: string) {
    let tries = 0;
    stopPolling();
    pollRef.current = setInterval(async () => {
      tries += 1;
      try {
        const res = await fetch(`/api/calls/${id}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { liveState: LiveState };
          setLiveState(data.liveState);
          if (data.liveState === "completed" || data.liveState === "failed") {
            stopPolling();
            setPhase("done");
          }
        }
      } catch {
        // transient; keep polling until the cap
      }
      if (tries >= 30) {
        stopPolling();
        setPhase("done");
      }
    }, 2000);
  }

  async function placeCall() {
    setPhase("placing");
    setError(null);
    const form = new FormData();
    form.set("contactId", contactId);
    form.set("toNumber", number);
    form.set("recordingConsent", consent);
    form.set("requestId", `call-${contactId}-${Date.now()}`);
    try {
      const result = await placeCallAction(form);
      setCallId(result.callId);
      setLiveState(result.liveState);
      if (result.error) {
        setError(result.error);
        setPhase("error");
        return;
      }
      if (result.liveState === "completed" || result.liveState === "failed") {
        setPhase("done");
        return;
      }
      setPhase("live");
      poll(result.callId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place the call.");
      setPhase("error");
    }
  }

  const busy = phase === "placing" || phase === "live";

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? "icon-sm" : size}
        className={className}
        disabled={disabled}
        title={blockReason ?? (!phone ? "No phone number on file" : `Call ${contactName}`)}
        aria-label={iconOnly ? `Call ${contactName}` : undefined}
        onClick={() => setOpen(true)}
      >
        <Phone aria-hidden="true" />
        {iconOnly ? null : label}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Call {contactName}</DialogTitle>
            <DialogDescription>
              {callerLabel ? `Calling from ${callerLabel}. ` : ""}
              Your RingCentral phone rings first — answer it to connect to the lead.
            </DialogDescription>
          </DialogHeader>

          {phase === "idle" || phase === "placing" ? (
            <div className="flex flex-col gap-4">
              <input
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                inputMode="tel"
                aria-label="Number to dial"
                className={cn(fieldClass, "h-11 text-center text-lg tracking-wider")}
                placeholder="+1 (___) ___-____"
              />

              <div className="grid grid-cols-3 gap-2">
                {DIAL_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setNumber((prev) => prev + key)}
                    className="bg-card hover:bg-[var(--bg-subtle)] h-11 rounded-md border text-base font-medium text-foreground transition-colors"
                  >
                    {key}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="call-consent" className="text-xs font-medium text-muted-foreground">
                    Recording consent
                  </label>
                  <select
                    id="call-consent"
                    value={consent}
                    onChange={(event) => setConsent(event.target.value as (typeof CONSENTS)[number])}
                    className={cn(fieldClass, "h-8 w-28")}
                  >
                    {CONSENTS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setNumber((prev) => prev.slice(0, -1))}
                  className="text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs"
                  aria-label="Delete last digit"
                >
                  <Delete className="size-4" aria-hidden="true" />
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                Calls may be recorded. Confirm the contact consents before recording in two-party-consent regions.
              </p>

              <Button type="button" onClick={placeCall} disabled={!number.trim() || phase === "placing"}>
                {phase === "placing" ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Placing…
                  </>
                ) : (
                  <>
                    <PhoneCall aria-hidden="true" />
                    Call {number.trim() || contactName}
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              {phase === "error" || liveState === "failed" ? (
                <PhoneOff className="size-8 text-[var(--ui-destructive)]" aria-hidden="true" />
              ) : phase === "done" ? (
                <PhoneCall className="size-8 text-[var(--teal-700)]" aria-hidden="true" />
              ) : (
                <Loader2 className="size-8 animate-spin text-[var(--syn-primary)]" aria-hidden="true" />
              )}
              <p className="text-sm font-medium text-foreground">{liveMessage(phase, liveState, contactName)}</p>
              {error ? <p className="text-xs text-[var(--ui-destructive)]">{error}</p> : null}
              <div className="mt-2 flex items-center gap-2">
                <Link href="/crm/calls" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  View call log
                </Link>
                {phase === "done" || phase === "error" ? (
                  <Button type="button" size="sm" variant="ghost" onClick={reset}>
                    New call
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                    Done
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function liveMessage(phase: Phase, liveState: LiveState, contactName: string): string {
  if (phase === "error" || liveState === "failed") return "Call failed.";
  if (liveState === "ringing") return `Ringing your phone — answer to connect to ${contactName}.`;
  if (liveState === "connected") return "Connected.";
  if (phase === "done" || liveState === "completed") {
    return "Call finished. Any recording will appear in the call log shortly.";
  }
  return "Placing the call…";
}
