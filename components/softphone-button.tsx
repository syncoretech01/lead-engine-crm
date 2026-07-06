"use client";

import * as React from "react";
import Link from "next/link";
import { Delete, Loader2, Mic, MicOff, Phone, PhoneCall, PhoneOff } from "lucide-react";

import { logSoftphoneCallAction, placeCallAction } from "@/app/actions";
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

// Type-only: the class is dynamically imported in the browser (it touches
// `document`/`navigator`/WebRTC, so it must never load on the server).
import type WebPhoneClass from "ringcentral-web-phone";
type CallSession = Awaited<ReturnType<WebPhoneClass["call"]>>;

type SoftphoneButtonProps = {
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

type Status = "idle" | "connecting" | "ringing" | "in-call" | "ended" | "error" | "ringout-done";
type Outcome = "completed" | "no-answer" | "failed";

const CONSENTS = ["Granted", "Denied", "Unknown"] as const;
const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
// If the INVITE never even reaches "ringing" within this window, treat it as stuck.
const CONNECT_TIMEOUT_MS = 25_000;
// SIP final responses that mean "callee was reached but did not pick up" (vs a
// technical failure). These log as No answer rather than Failed.
const NO_ANSWER_CODES = new Set([408, 480, 486, 487, 600, 603]);

// One shared WebPhone per browser tab: registering SIP is expensive and the
// registration is reused across every call button on the page.
let webPhonePromise: Promise<{ webPhone: WebPhoneClass; callerId: string | null }> | null = null;

async function ensureWebPhone(): Promise<{ webPhone: WebPhoneClass; callerId: string | null }> {
  if (webPhonePromise) return webPhonePromise;
  webPhonePromise = (async () => {
    const res = await fetch("/api/rc/sip-provision", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as {
      sipInfo?: unknown;
      callerId?: string | null;
      error?: string;
    };
    if (!res.ok || !data.sipInfo) {
      throw new Error(data.error || `Could not set up the softphone (HTTP ${res.status}).`);
    }
    const mod = await import("ringcentral-web-phone");
    const WebPhone = mod.default;
    const webPhone = new WebPhone({
      sipInfo: data.sipInfo as ConstructorParameters<typeof WebPhone>[0]["sipInfo"],
      instanceId: softphoneInstanceId()
    });
    await webPhone.start();
    return { webPhone, callerId: data.callerId ?? null };
  })();
  // A failed provision must not be cached — allow the next attempt to retry.
  webPhonePromise.catch(() => {
    webPhonePromise = null;
  });
  return webPhonePromise;
}

// A stable per-browser instance id keeps SIP registration from piling up
// duplicate devices across reloads.
function softphoneInstanceId(): string {
  try {
    const KEY = "syncore.softphone.instanceId";
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const id = window.crypto?.randomUUID?.() ?? `wp-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    return `wp-${Date.now()}`;
  }
}

// RingCentral routes on a plain E.164-ish number. Keep a leading + if present,
// otherwise assume North America when 10 digits are dialed.
function toDialString(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) return "+" + trimmed.slice(1).replace(/\D/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits ? "+" + digits : "";
}

function isMicError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "NotAllowedError" ||
    error.name === "NotFoundError" ||
    error.name === "SecurityError" ||
    /permission|microphone|denied/i.test(error.message)
  );
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function SoftphoneButton({
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
}: SoftphoneButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [number, setNumber] = React.useState(phone ?? "");
  const [consent, setConsent] = React.useState<(typeof CONSENTS)[number]>("Granted");
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [muted, setMuted] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);

  const sessionRef = React.useRef<CallSession | null>(null);
  const handlersRef = React.useRef<Array<[string, (...args: unknown[]) => void]>>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedAtRef = React.useRef<number | null>(null);
  const audioElRef = React.useRef<HTMLAudioElement | null>(null);
  const wasConnectedRef = React.useRef(false);
  const endedRef = React.useRef(false);
  const providerCallIdRef = React.useRef<string | undefined>(undefined);
  const telephonySessionIdRef = React.useRef<string | undefined>(undefined);
  const consentRef = React.useRef<(typeof CONSENTS)[number]>("Granted");
  const mountedRef = React.useRef(true);
  // Blocks dialog dismissal ONLY during the softphone connect window (provisioning
  // + INVITE), where there's no dialog to CANCEL yet. The RingOut fallback and the
  // idle dialpad stay freely dismissable.
  const blockCloseRef = React.useRef(false);

  const disabled = Boolean(blockReason) || !phone;

  const stopTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearConnectTimeout = React.useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  const startTimer = React.useCallback(() => {
    if (timerRef.current) return;
    connectedAtRef.current = Date.now();
    setSeconds(0);
    timerRef.current = setInterval(() => {
      if (connectedAtRef.current) {
        setSeconds(Math.round((Date.now() - connectedAtRef.current) / 1000));
      }
    }, 1000);
  }, []);

  // The SDK creates session.audioElement lazily inside RTCPeerConnection.ontrack
  // (which fires AFTER "answered"), and never appends it to the DOM. So poll until
  // it exists, then append + explicitly play() it (autoplay alone is unreliable on
  // Safari/Firefox). Self-terminates when the call ends or is superseded.
  const attachAudio = React.useCallback((session: CallSession) => {
    let attempts = 60; // ~3s at 50ms
    const tryAttach = () => {
      if (sessionRef.current !== session || endedRef.current) return;
      const el = session.audioElement;
      if (!el) {
        if (attempts-- > 0) setTimeout(tryAttach, 50);
        return;
      }
      audioElRef.current = el;
      el.hidden = true;
      if (!el.isConnected) document.body.appendChild(el);
      void el.play().catch(() => {
        // Autoplay is satisfied by the click that started the call; ignore races.
      });
    };
    tryAttach();
  }, []);

  const detachAudio = React.useCallback(() => {
    const el = audioElRef.current;
    if (el?.isConnected) el.remove();
    audioElRef.current = null;
  }, []);

  // Remove our listeners AND dispose the SIP session. dispose() is what actually
  // closes the RTCPeerConnection and stops the mic tracks — hangup()/cancel() only
  // send SIP and leave the mic live. Idempotent + safe (its "disposed" emit has no
  // listeners of ours left).
  const cleanupSession = React.useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      for (const [event, handler] of handlersRef.current) {
        try {
          session.off(event, handler);
        } catch {
          // best effort
        }
      }
      if (session.state === "init" || session.state === "ringing") {
        // Aborting a call that hasn't answered: free the mic + peer connection now,
        // but guard a late SIP transition so an INVITE that answers (or a 200 that
        // races our CANCEL) after we bail is hung up rather than left as a ghost.
        try {
          session.mediaStream?.getTracks().forEach((track) => track.stop());
        } catch {
          // best effort
        }
        try {
          session.rtcPeerConnection?.close();
        } catch {
          // best effort
        }
        try {
          session.once("answered", () => {
            try {
              void session.hangup();
            } catch {
              // best effort
            }
          });
          session.once("ringing", () => {
            try {
              void session.cancel();
            } catch {
              // best effort
            }
          });
        } catch {
          // best effort
        }
      } else {
        // Answered/failed/disposed: dispose() closes the peer connection and stops
        // the mic tracks (hangup()/cancel() alone do not).
        try {
          session.dispose();
        } catch {
          // best effort
        }
      }
    }
    handlersRef.current = [];
    sessionRef.current = null;
  }, []);

  const logCall = React.useCallback(
    async (durationSeconds: number, outcome: Outcome) => {
      try {
        const form = new FormData();
        form.set("contactId", contactId);
        form.set("durationSeconds", String(durationSeconds));
        form.set("outcome", outcome);
        form.set("recordingConsent", consentRef.current);
        if (providerCallIdRef.current) form.set("providerCallId", providerCallIdRef.current);
        if (telephonySessionIdRef.current) form.set("telephonySessionId", telephonySessionIdRef.current);
        await logSoftphoneCallAction(form);
      } catch {
        // Logging is best-effort; never block the call UI on it.
      }
    },
    [contactId]
  );

  // Finalize an active call exactly once: stop timers, free audio + mic + listeners,
  // and log the TrackedCall. Does NOT touch `status` (safe during unmount); mounted
  // callers set status themselves.
  const finalize = React.useCallback(
    (final: "ended" | "error"): Outcome | null => {
      if (endedRef.current) return null;
      endedRef.current = true;
      blockCloseRef.current = false;
      clearConnectTimeout();
      stopTimer();
      const duration =
        wasConnectedRef.current && connectedAtRef.current
          ? Math.round((Date.now() - connectedAtRef.current) / 1000)
          : 0;
      detachAudio();
      cleanupSession();
      const outcome: Outcome = wasConnectedRef.current ? "completed" : final === "error" ? "failed" : "no-answer";
      void logCall(duration, outcome);
      return outcome;
    },
    [cleanupSession, clearConnectTimeout, detachAudio, logCall, stopTimer]
  );

  const endCall = React.useCallback(
    (final: "ended" | "error") => {
      if (finalize(final)) setStatus(final);
    },
    [finalize]
  );

  const attachSession = React.useCallback(
    (session: CallSession) => {
      sessionRef.current = session;
      wasConnectedRef.current = false;
      endedRef.current = false;
      connectedAtRef.current = null;
      providerCallIdRef.current = session.callId || undefined;
      telephonySessionIdRef.current = session.sessionId || undefined;

      const onRinging = () => {
        clearConnectTimeout();
        blockCloseRef.current = false; // now cancelable via the UI
        if (!telephonySessionIdRef.current && session.sessionId) {
          telephonySessionIdRef.current = session.sessionId;
        }
        setStatus((s) => (s === "in-call" || s === "ended" ? s : "ringing"));
      };
      const onAnswered = () => {
        if (wasConnectedRef.current) return;
        clearConnectTimeout();
        blockCloseRef.current = false;
        wasConnectedRef.current = true;
        if (session.sessionId) telephonySessionIdRef.current = session.sessionId;
        startTimer();
        attachAudio(session);
        setStatus("in-call");
        // Record on-demand when consented — account auto-recording doesn't capture
        // these VoIP calls. Best-effort: a recording failure must never break the call.
        if (consentRef.current === "Granted") {
          void session.startRecording().catch(() => {});
        }
      };
      const onDisposed = () => endCall("ended");
      const onFailed = (subject?: unknown) => {
        const code = typeof subject === "string" ? Number(subject.match(/SIP\/2\.0\s+(\d{3})/)?.[1]) : NaN;
        // Reached-but-no-pickup logs as No answer; everything else as Failed.
        endCall(NO_ANSWER_CODES.has(code) ? "ended" : "error");
      };

      const handlers: Array<[string, (...args: unknown[]) => void]> = [
        ["ringing", onRinging],
        ["answered", onAnswered],
        ["disposed", onDisposed],
        ["failed", onFailed as (...args: unknown[]) => void]
      ];
      for (const [event, handler] of handlers) session.on(event, handler);
      handlersRef.current = handlers;
    },
    [attachAudio, clearConnectTimeout, endCall, startTimer]
  );

  // Signal SIP teardown with the right verb: BYE after answer, CANCEL while ringing.
  // At "init" there is no dialog yet to CANCEL — cleanupSession's dispose() stops the
  // mic + peer connection so no audio can leak even if the INVITE later answers.
  const terminateSession = React.useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      if (session.state === "answered") void session.hangup();
      else if (session.state === "ringing") void session.cancel();
    } catch {
      // the disposed/failed event (or dispose) still drives cleanup
    }
  }, []);

  const reset = React.useCallback(() => {
    if (sessionRef.current && !endedRef.current) {
      terminateSession();
      finalize("ended"); // log the in-progress call before we drop its listeners
    } else {
      clearConnectTimeout();
      stopTimer();
      detachAudio();
      cleanupSession();
    }
    endedRef.current = false;
    blockCloseRef.current = false;
    wasConnectedRef.current = false;
    connectedAtRef.current = null;
    setStatus("idle");
    setError(null);
    setMuted(false);
    setSeconds(0);
    setNumber(phone ?? "");
  }, [cleanupSession, clearConnectTimeout, detachAudio, finalize, phone, stopTimer, terminateSession]);

  // Dedicated mount flag (empty deps) so it only flips on real unmount.
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // On unmount, end + log any live call and free every resource. `finalize`
  // (not `endCall`) avoids a setState on an unmounted component.
  React.useEffect(() => {
    return () => {
      if (sessionRef.current && !endedRef.current) {
        terminateSession();
        finalize("ended");
      } else {
        clearConnectTimeout();
        stopTimer();
        detachAudio();
        cleanupSession();
      }
    };
  }, [cleanupSession, clearConnectTimeout, detachAudio, finalize, stopTimer, terminateSession]);

  function onOpenChange(next: boolean) {
    // Block dismissal only during the softphone connect window (there's no dialog to
    // CANCEL yet). The RingOut fallback and idle dialpad stay dismissable.
    if (!next && blockCloseRef.current) return;
    if (!next) reset();
    setOpen(next);
  }

  async function startCall() {
    const dial = toDialString(number);
    if (!dial) {
      setError("Enter a valid number to dial.");
      setStatus("error");
      return;
    }
    consentRef.current = consent;
    setError(null);
    setMuted(false);
    setSeconds(0);
    endedRef.current = false;
    blockCloseRef.current = true;
    setStatus("connecting");

    // Arm the stuck-connect safety net up front so it also covers a hung provision.
    // `removeOutbound` is a no-op until the INVITE phase reassigns it, so the timeout
    // can call it safely even while provisioning.
    let removeOutbound = () => {};
    clearConnectTimeout();
    connectTimerRef.current = setTimeout(() => {
      if (endedRef.current) return;
      const s = sessionRef.current;
      if (s && (s.state === "ringing" || s.state === "answered")) return;
      removeOutbound();
      terminateSession();
      finalize("error");
      setError("The call couldn't connect (timed out). Try again, or ring your phone instead.");
      setStatus("error");
    }, CONNECT_TIMEOUT_MS);

    let provisioned: { webPhone: WebPhoneClass; callerId: string | null };
    try {
      await ensureMicPermission();
      provisioned = await ensureWebPhone();
    } catch (err) {
      clearConnectTimeout();
      blockCloseRef.current = false;
      if (endedRef.current || !mountedRef.current) return;
      setError(
        isMicError(err)
          ? "Microphone access is required for browser calling. Allow it in your browser, or ring your phone instead."
          : err instanceof Error
            ? err.message
            : "Could not set up the softphone."
      );
      setStatus("error");
      return;
    }
    if (endedRef.current || !mountedRef.current) {
      clearConnectTimeout();
      return;
    }

    const wp = provisioned.webPhone;
    const callerId = provisioned.callerId ? provisioned.callerId.replace(/[^\d+]/g, "") : undefined;

    // The SDK emits "outboundCall" synchronously, before it awaits the answer, so
    // grab the session THERE — webPhone.call() itself won't resolve until the call
    // is answered or fails, which would otherwise skip the whole ringing phase.
    let placedSession: CallSession | null = null;
    const outboundHandler = (session: CallSession) => {
      placedSession = session;
      removeOutbound();
      if (endedRef.current || !mountedRef.current) {
        try {
          session.dispose();
        } catch {
          // best effort
        }
        return;
      }
      attachSession(session);
    };
    removeOutbound = () => {
      try {
        wp.off("outboundCall", outboundHandler as (...args: unknown[]) => void);
      } catch {
        // best effort
      }
    };
    wp.on("outboundCall", outboundHandler as (...args: unknown[]) => void);

    try {
      await wp.call(dial, callerId);
    } catch (err) {
      removeOutbound();
      // If we bailed mid-init, dispose() ran before the mic stream existed; init()
      // then acquired a live stream and addTrack threw on the closed peer, rejecting
      // here. Stop that orphaned stream so the mic doesn't stay live.
      try {
        (placedSession as CallSession | null)?.mediaStream?.getTracks().forEach((track) => track.stop());
      } catch {
        // best effort
      }
      if (endedRef.current || !mountedRef.current) return;
      clearConnectTimeout();
      blockCloseRef.current = false;
      setError(err instanceof Error ? err.message : "The call could not be placed.");
      endCall("error");
      return;
    }
    removeOutbound();
    if (!mountedRef.current) return;

    // A SIP 403 on the INVITE returns with no event and state still "init".
    const session = sessionRef.current;
    if (!endedRef.current && session && session.state === "init") {
      blockCloseRef.current = false;
      setError("The call was rejected — the number or your line may not be permitted.");
      endCall("error");
    }
  }

  function hangup() {
    const session = sessionRef.current;
    if (!session) return;
    try {
      if (session.state === "answered") void session.hangup();
      else void session.cancel();
    } catch {
      // finalize below still tears everything down
    }
    // Finalize synchronously so the trailing 487/BYE-response event can't relabel
    // the outcome (its listeners are removed here).
    endCall("ended");
  }

  function toggleMute() {
    const session = sessionRef.current;
    if (!session) return;
    if (muted) {
      session.unmute();
      setMuted(false);
    } else {
      session.mute();
      setMuted(true);
    }
  }

  function onDialKey(key: string) {
    if (status === "in-call") {
      sessionRef.current?.sendDtmf(key);
      return;
    }
    setNumber((prev) => prev + key);
  }

  // RingOut fallback: rings the SDR's own phone first, then bridges the lead.
  // Used when the browser softphone can't run (mic denied, no per-SDR line, etc.).
  async function ringMyPhoneInstead() {
    setError(null);
    blockCloseRef.current = false; // RingOut has no in-flight INVITE to strand
    setStatus("connecting");
    consentRef.current = consent;
    const form = new FormData();
    form.set("contactId", contactId);
    form.set("toNumber", number);
    form.set("recordingConsent", consent);
    form.set("requestId", `call-${contactId}-${Date.now()}`);
    try {
      const result = await placeCallAction(form);
      if (result.error) {
        setError(result.error);
        setStatus("error");
        return;
      }
      setStatus("ringout-done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place the call.");
      setStatus("error");
    }
  }

  const inLiveCall = status === "connecting" || status === "ringing" || status === "in-call";

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
              Talk directly in your browser — no phone rings first.
            </DialogDescription>
          </DialogHeader>

          {status === "idle" ? (
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
                    onClick={() => onDialKey(key)}
                    className="bg-card hover:bg-[var(--bg-subtle)] h-11 rounded-md border text-base font-medium text-foreground transition-colors"
                  >
                    {key}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="sp-consent" className="text-xs font-medium text-muted-foreground">
                    Recording consent
                  </label>
                  <select
                    id="sp-consent"
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

              <Button type="button" onClick={startCall} disabled={!number.trim()}>
                <PhoneCall aria-hidden="true" />
                Call {number.trim() || contactName}
              </Button>
            </div>
          ) : inLiveCall ? (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-[var(--bg-subtle)]">
                {status === "in-call" ? (
                  <PhoneCall className="size-7 text-[var(--teal-700)]" aria-hidden="true" />
                ) : (
                  <Loader2 className="size-7 animate-spin text-[var(--syn-primary)]" aria-hidden="true" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {status === "connecting"
                    ? "Connecting…"
                    : status === "ringing"
                      ? `Ringing ${contactName}…`
                      : contactName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {status === "in-call" ? formatClock(seconds) : number.trim()}
                </p>
              </div>

              {status === "in-call" ? (
                <div className="grid w-full grid-cols-3 gap-2">
                  {DIAL_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onDialKey(key)}
                      className="bg-card hover:bg-[var(--bg-subtle)] h-9 rounded-md border text-sm font-medium text-foreground transition-colors"
                    >
                      {key}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                {status === "in-call" ? (
                  <Button type="button" variant="outline" size="sm" onClick={toggleMute}>
                    {muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
                    {muted ? "Unmute" : "Mute"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className="bg-[var(--ui-destructive)] text-white hover:opacity-90"
                  onClick={hangup}
                  disabled={status === "connecting"}
                >
                  <PhoneOff aria-hidden="true" />
                  {status === "ringing" ? "Cancel" : "Hang up"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              {status === "error" ? (
                <PhoneOff className="size-8 text-[var(--ui-destructive)]" aria-hidden="true" />
              ) : (
                <PhoneCall className="size-8 text-[var(--teal-700)]" aria-hidden="true" />
              )}
              <p className="text-sm font-medium text-foreground">
                {status === "ringout-done"
                  ? `Ringing your phone — answer to connect to ${contactName}.`
                  : status === "error"
                    ? "Call couldn't connect."
                    : seconds > 0
                      ? `Call finished · ${formatClock(seconds)}`
                      : "Call ended — no answer."}
              </p>
              {error ? <p className="text-xs text-[var(--ui-destructive)]">{error}</p> : null}
              {status === "error" ? (
                <p className="text-xs text-muted-foreground">
                  You can retry in the browser, or ring your own phone and bridge the lead instead.
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                {status === "error" ? (
                  <>
                    <Button type="button" size="sm" onClick={startCall}>
                      <PhoneCall aria-hidden="true" />
                      Try again
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={ringMyPhoneInstead}>
                      <Phone aria-hidden="true" />
                      Ring my phone instead
                    </Button>
                  </>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={reset}>
                    New call
                  </Button>
                )}
                <Link href="/crm/calls" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  View call log
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

async function ensureMicPermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser doesn't support in-browser calling.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // Release immediately; the SDK re-acquires the mic when the call starts.
  stream.getTracks().forEach((track) => track.stop());
}
