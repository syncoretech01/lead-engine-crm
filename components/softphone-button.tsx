"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  Delete,
  ExternalLink,
  Loader2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOff,
  RefreshCw,
  StickyNote,
  Voicemail
} from "lucide-react";

import { createNoteAction, logSoftphoneCallAction, placeCallAction } from "@/app/actions";
import { enqueueCallPersistence } from "@/components/call/call-persistence-queue";
import { searchCrmRecordsAction } from "@/app/crm/search-actions";
import {
  useCall,
  type CallConsent,
  type CallSnapshot,
  type CallSurface,
  type CallTarget
} from "@/components/call/call-context";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { fieldClass, fieldTextareaClass } from "@/components/ui/field";
import { appendDtmfDigit, isDtmfKey, playDtmfTone } from "@/lib/dtmf-feedback";
import {
  playIncomingCallRingPulse,
  primeIncomingCallAudio
} from "@/lib/incoming-call-ringtone";
import { phoneNumbersEquivalent } from "@/lib/phone-search";
import { cn } from "@/lib/utils";

// Type-only: the class is dynamically imported in the browser (it touches
// `document`/`navigator`/WebRTC, so it must never load on the server).
import type WebPhoneClass from "ringcentral-web-phone";
import type InboundCallSession from "ringcentral-web-phone/call-session/inbound";
type OutboundCallSession = Awaited<ReturnType<WebPhoneClass["call"]>>;
type CallSession = OutboundCallSession | InboundCallSession;
type TransferCapableSession = CallSession & {
  transfer?: (targetNumber: string, timeout?: number) => Promise<unknown>;
  // Lower-level REFER with a full SIP URI. The public transfer() hardcodes the
  // Refer-To domain to sip.ringcentral.com; _transfer lets us set the account's
  // real SIP edge domain instead (see transferCall).
  _transfer?: (uri: string, timeout?: number) => Promise<void>;
  webPhone?: { sipInfo?: { domain?: string } };
};

type TransferTarget = {
  id: string;
  name: string;
  email: string;
  role: string;
  phoneNumber: string;
  label: string;
};

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
type CallDirection = "Inbound" | "Outbound";

type IncomingCallView = {
  session: InboundCallSession;
  phone: string;
  displayName: string;
  accountName: string | null;
  contactId: string | null;
  lookingUp: boolean;
  actionPending: "answer" | "voicemail" | null;
  error: string | null;
};

type InboundRegistrationView = {
  status: "idle" | "connecting" | "ready" | "reconnecting";
  error: string | null;
};

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
let sharedWebPhone: WebPhoneClass | null = null;
type InboundCallHandler = (session: InboundCallSession) => void;
const inboundCallHandlers = new Set<InboundCallHandler>();

function subscribeToInboundCalls(handler: InboundCallHandler) {
  inboundCallHandlers.add(handler);
  sharedWebPhone?.on("inboundCall", handler as (...args: unknown[]) => void);
  return () => {
    inboundCallHandlers.delete(handler);
    try {
      sharedWebPhone?.off("inboundCall", handler as (...args: unknown[]) => void);
    } catch {
      // best effort
    }
  };
}

function disposeSharedWebPhoneWhenUnused() {
  window.setTimeout(() => {
    if (inboundCallHandlers.size > 0 || !sharedWebPhone) return;
    const webPhone = sharedWebPhone;
    sharedWebPhone = null;
    webPhonePromise = null;
    void webPhone.dispose().catch(() => {});
  }, 0);
}

// The account's real SIP edge domain from provisioning. Outbound INVITEs use it
// (and connect fine); the transfer Refer-To must use the same domain, or RC
// accepts the REFER (dropping the SDR) but can't route the manager call.
let sipProvisionDomain: string | null = null;

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
    sipProvisionDomain = (data.sipInfo as { domain?: string })?.domain ?? null;
    const mod = await import("ringcentral-web-phone");
    const WebPhone = mod.default;
    const webPhone = new WebPhone({
      sipInfo: data.sipInfo as ConstructorParameters<typeof WebPhone>[0]["sipInfo"],
      instanceId: softphoneInstanceId()
    });
    sharedWebPhone = webPhone;
    for (const handler of inboundCallHandlers) {
      webPhone.on("inboundCall", handler as (...args: unknown[]) => void);
    }
    await webPhone.start();
    return { webPhone, callerId: data.callerId ?? null };
  })();
  // A failed provision must not be cached — allow the next attempt to retry.
  webPhonePromise.catch(() => {
    const failedWebPhone = sharedWebPhone;
    webPhonePromise = null;
    sharedWebPhone = null;
    if (failedWebPhone) void failedWebPhone.dispose().catch(() => {});
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

function isInboundSession(session: CallSession): session is InboundCallSession {
  return session.direction === "inbound";
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export type SoftphoneEngineHandle = {
  /** Open the modal call dialog for a contact (legacy per-page buttons). */
  openCall: (target: CallTarget) => void;
  /** Start a call rendered inline in the Focus dock (no modal). */
  openCallInline: (target: CallTarget) => void;
  hangup: () => void;
  toggleMute: () => void;
  sendDtmf: (key: string) => void;
  setConsent: (consent: CallConsent) => void;
  retry: () => void;
  reset: () => void;
  ringMyPhone: () => void;
  loadTransferTargets: () => void;
  selectTransferTarget: (id: string) => void;
  setTransferNumber: (value: string) => void;
  transferCall: () => void;
};

type SoftphoneEngineProps = {
  registerInbound?: boolean;
  onStateChange?: (state: {
    busy: boolean;
    activeContactId: string | null;
    snapshot: CallSnapshot;
  }) => void;
};

// The live-call engine. Mounted ONCE by CallProvider (in the root layout) so the
// WebRTC session survives client-side navigation — the per-page SoftphoneButton
// below just triggers `openCall`. Its call target comes from state (set via the
// imperative `openCall`) rather than props; everything else is unchanged.
export const SoftphoneEngine = React.forwardRef<SoftphoneEngineHandle, SoftphoneEngineProps>(
  function SoftphoneEngine({ onStateChange, registerInbound = false }, ref) {
  const [target, setTarget] = React.useState<CallTarget | null>(null);
  const contactId = target?.contactId ?? "";
  const contactName = target?.contactName ?? "contact";
  const phone = target?.phone;
  const callerLabel = target?.callerLabel;
  const [open, setOpen] = React.useState(false);
  // Which surface owns the call: the modal dialog (legacy per-page buttons) or the
  // Focus cockpit dock. Default "dialog" so every existing SoftphoneButton path is
  // byte-for-byte unchanged; the dock uses openCallInline to claim "dock".
  const [surface, setSurface] = React.useState<CallSurface>("dialog");
  // Backgrounded call: the dialog is closed to a small floating bar while the
  // call keeps running (clicking outside during a call minimizes, never hangs up).
  const [minimized, setMinimized] = React.useState(false);
  const [number, setNumber] = React.useState(phone ?? "");
  const [consent, setConsent] = React.useState<(typeof CONSENTS)[number]>("Granted");
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [muted, setMuted] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);
  const [dtmfDigits, setDtmfDigits] = React.useState("");
  // On-demand recording actually running (mirrors recordingStartedRef as state so
  // the dock can show a live "Recording" indicator).
  const [recording, setRecording] = React.useState(false);
  // Call notes the SDR jots down; saved to the contact timeline as a "Call note".
  const [notes, setNotes] = React.useState("");
  const [noteSaving, setNoteSaving] = React.useState(false);
  const [noteSaved, setNoteSaved] = React.useState(false);
  const [transferTargets, setTransferTargets] = React.useState<TransferTarget[]>([]);
  const [transferTargetsLoading, setTransferTargetsLoading] = React.useState(false);
  const [selectedTransferTargetId, setSelectedTransferTargetId] = React.useState("");
  const [transferNumber, setTransferNumber] = React.useState("");
  const [transferPending, setTransferPending] = React.useState(false);
  const [transferError, setTransferError] = React.useState<string | null>(null);
  const [transferMessage, setTransferMessage] = React.useState<string | null>(null);
  const [direction, setDirection] = React.useState<CallDirection>("Outbound");
  const [incomingCall, setIncomingCall] = React.useState<IncomingCallView | null>(null);
  const [inboundRegistration, setInboundRegistration] = React.useState<InboundRegistrationView>({
    status: registerInbound ? "connecting" : "idle",
    error: null
  });

  const sessionRef = React.useRef<CallSession | null>(null);
  const statusRef = React.useRef<Status>("idle");
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
  const directionRef = React.useRef<CallDirection>("Outbound");
  // The contact being called, held in a ref so the call-log closures use the
  // CURRENT target even when the inline/dock path starts a call in the same tick
  // as setTarget (the render's `contactId` closure would still be the old one).
  const contactIdRef = React.useRef<string>("");
  // Records whether on-demand recording actually started, and the failure reason
  // if it didn't — so a silent startRecording() failure becomes diagnosable.
  const recordingStartedRef = React.useRef(false);
  const recordingStartErrorRef = React.useRef<string | undefined>(undefined);
  const mountedRef = React.useRef(true);
  // Blocks dialog dismissal ONLY during the softphone connect window (provisioning
  // + INVITE), where there's no dialog to CANCEL yet. The RingOut fallback and the
  // idle dialpad stay freely dismissable.
  const blockCloseRef = React.useRef(false);
  const ringtoneTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const incomingNotificationRef = React.useRef<Notification | null>(null);
  const previousDocumentTitleRef = React.useRef<string | null>(null);

  const resetTransferState = React.useCallback(() => {
    setTransferPending(false);
    setTransferError(null);
    setTransferMessage(null);
  }, []);

  const stopIncomingAlerts = React.useCallback(() => {
    if (ringtoneTimerRef.current) {
      clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    incomingNotificationRef.current?.close();
    incomingNotificationRef.current = null;
    if (previousDocumentTitleRef.current !== null) {
      document.title = previousDocumentTitleRef.current;
      previousDocumentTitleRef.current = null;
    }
  }, []);

  const startIncomingAlerts = React.useCallback((caller: string) => {
    if (previousDocumentTitleRef.current === null) {
      previousDocumentTitleRef.current = document.title;
    }
    document.title = `Incoming call — ${caller}`;

    void playIncomingCallRingPulse();
    if (ringtoneTimerRef.current) clearInterval(ringtoneTimerRef.current);
    ringtoneTimerRef.current = setInterval(() => {
      void playIncomingCallRingPulse();
    }, 2_200);

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        incomingNotificationRef.current?.close();
        const notification = new Notification("Incoming CRM call", {
          body: caller,
          icon: "/icon.png",
          tag: "syncore-incoming-call",
          requireInteraction: true
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
        incomingNotificationRef.current = notification;
      } catch {
        // The in-app card and ringtone remain available when OS notifications fail.
      }
    }
  }, []);

  const loadTransferTargets = React.useCallback(async () => {
    if (transferTargetsLoading) return;
    setTransferTargetsLoading(true);
    setTransferError(null);
    try {
      const response = await fetch("/api/rc/transfer-targets", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        targets?: TransferTarget[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Could not load managers (HTTP ${response.status}).`);
      }

      const targets = data.targets ?? [];
      setTransferTargets(targets);
      if (!selectedTransferTargetId && !transferNumber && targets[0]) {
        setSelectedTransferTargetId(targets[0].id);
        setTransferNumber(targets[0].phoneNumber);
      }
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Could not load manager transfer targets.");
    } finally {
      setTransferTargetsLoading(false);
    }
  }, [selectedTransferTargetId, transferNumber, transferTargetsLoading]);

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
              if (isInboundSession(session)) void session.toVoicemail();
              else void session.cancel();
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
      const activeContactId = contactIdRef.current || contactId;
      // The existing TrackedCall model is contact-backed. Unknown callers still
      // appear and can be answered, but are not attached to an unrelated record.
      if (!activeContactId) return;
      try {
        const form = new FormData();
        form.set("contactId", activeContactId);
        form.set("durationSeconds", String(durationSeconds));
        form.set("outcome", outcome);
        form.set("direction", directionRef.current);
        form.set("recordingConsent", consentRef.current);
        if (providerCallIdRef.current) form.set("providerCallId", providerCallIdRef.current);
        if (telephonySessionIdRef.current) form.set("telephonySessionId", telephonySessionIdRef.current);
        // Recording diagnostics: whether on-demand recording started, and why not.
        if (consentRef.current === "Granted") {
          form.set("recordingStarted", recordingStartedRef.current ? "true" : "false");
          if (recordingStartErrorRef.current) {
            form.set("recordingStartError", recordingStartErrorRef.current);
          }
        }
        await enqueueCallPersistence(() => logSoftphoneCallAction(form));
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
      stopIncomingAlerts();
      cleanupSession();
      const outcome: Outcome = wasConnectedRef.current ? "completed" : final === "error" ? "failed" : "no-answer";
      void logCall(duration, outcome);
      return outcome;
    },
    [cleanupSession, clearConnectTimeout, detachAudio, logCall, stopIncomingAlerts, stopTimer]
  );

  const endCall = React.useCallback(
    (final: "ended" | "error") => {
      if (finalize(final)) {
        setIncomingCall(null);
        setStatus(final);
        setRecording(false);
        setMinimized(false); // call is over — drop the background bar
      }
    },
    [finalize]
  );

  const startSessionRecording = React.useCallback((session: CallSession) => {
    if (recordingStartedRef.current) return;
    recordingStartedRef.current = false;
    recordingStartErrorRef.current = undefined;
    void session
      .startRecording()
      .then(() => {
        recordingStartedRef.current = true;
        setRecording(true);
      })
      .catch((recordingError: unknown) => {
        const message =
          recordingError instanceof Error ? recordingError.message : String(recordingError);
        recordingStartErrorRef.current = message;
        console.error("[softphone] startRecording() failed:", message);
      });
  }, []);

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
        stopIncomingAlerts();
        setIncomingCall(null);
        if (isInboundSession(session)) {
          setSurface("dialog");
          setMinimized(false);
          setOpen(true);
        }
        void loadTransferTargets();
        // Record on-demand when consented — account auto-recording doesn't capture
        // these VoIP calls. Best-effort: a recording failure must never break the
        // call, but capture the reason so it's diagnosable instead of silent.
        if (consentRef.current === "Granted") {
          startSessionRecording(session);
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
    [
      attachAudio,
      clearConnectTimeout,
      endCall,
      loadTransferTargets,
      startSessionRecording,
      startTimer,
      stopIncomingAlerts
    ]
  );

  const handleInboundCall = React.useCallback(
    (session: InboundCallSession) => {
      const activeSession = sessionRef.current;
      const anotherCallIsStarting =
        blockCloseRef.current ||
        statusRef.current === "connecting" ||
        statusRef.current === "ringing" ||
        statusRef.current === "in-call";
      if (
        (activeSession && activeSession !== session && !endedRef.current) ||
        (!activeSession && anotherCallIsStarting)
      ) {
        // The CRM currently supports one media session at a time. Preserve the
        // active conversation and let the second caller leave a voicemail.
        void session.toVoicemail().catch(() => {});
        return;
      }

      const remoteNumber = session.remoteNumber?.trim() || "Unknown number";
      const providerName = session.rcApiCallInfo?.callerIdName?.trim();
      const initialName = providerName || remoteNumber;

      directionRef.current = "Inbound";
      consentRef.current = "Unknown";
      contactIdRef.current = "";
      recordingStartedRef.current = false;
      recordingStartErrorRef.current = undefined;
      setDirection("Inbound");
      setConsent("Unknown");
      setTarget({
        contactId: "",
        contactName: initialName,
        phone: remoteNumber,
        callerLabel: "Incoming RingCentral call"
      });
      setNumber(remoteNumber);
      setSurface("dialog");
      setOpen(false);
      setMinimized(false);
      setError(null);
      setMuted(false);
      setSeconds(0);
      setDtmfDigits("");
      setRecording(false);
      setNotes("");
      setNoteSaved(false);
      resetTransferState();
      setIncomingCall({
        session,
        phone: remoteNumber,
        displayName: initialName,
        accountName: null,
        contactId: null,
        lookingUp: remoteNumber !== "Unknown number",
        actionPending: null,
        error: null
      });
      attachSession(session);
      setStatus("ringing");
      startIncomingAlerts(initialName);

      if (remoteNumber === "Unknown number") return;
      void searchCrmRecordsAction(remoteNumber)
        .then((results) => {
          if (sessionRef.current !== session || endedRef.current) return;
          const contact = results.contacts.find((candidate) =>
            phoneNumbersEquivalent(candidate.phone, remoteNumber)
          );
          if (!contact) {
            setIncomingCall((current) =>
              current?.session === session ? { ...current, lookingUp: false } : current
            );
            return;
          }

          contactIdRef.current = contact.id;
          setTarget({
            contactId: contact.id,
            contactName: contact.name,
            phone: contact.phone ?? remoteNumber,
            callerLabel: "Incoming RingCentral call"
          });
          setIncomingCall((current) =>
            current?.session === session
              ? {
                  ...current,
                  displayName: contact.name,
                  accountName: contact.accountName,
                  contactId: contact.id,
                  lookingUp: false
                }
              : current
          );
        })
        .catch(() => {
          setIncomingCall((current) =>
            current?.session === session ? { ...current, lookingUp: false } : current
          );
        });
    },
    [attachSession, resetTransferState, startIncomingAlerts]
  );

  // Subscribe before provisioning so there is no registration-to-listener race.
  // Keep the WebSocket registered while the signed-in SDR uses the CRM and
  // recover it with capped exponential backoff after network changes.
  React.useEffect(() => {
    if (!registerInbound) {
      setInboundRegistration({ status: "idle", error: null });
      return;
    }

    setInboundRegistration({ status: "connecting", error: null });

    let cancelled = false;
    let webPhone: WebPhoneClass | null = null;
    let closeSocket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2_000;
    let reconnecting: Promise<void> | null = null;

    const removeCloseListener = () => {
      closeSocket?.removeEventListener("close", onUnexpectedClose);
      closeSocket = null;
    };

    const attachCloseListener = () => {
      removeCloseListener();
      const socket = (webPhone?.sipClient as { wsc?: WebSocket } | undefined)?.wsc;
      if (!socket) return;
      closeSocket = socket;
      socket.addEventListener("close", onUnexpectedClose);
    };

    const recover = async () => {
      if (cancelled) {
        disposeSharedWebPhoneWhenUnused();
        return;
      }
      if (!webPhone) {
        webPhone = (await ensureWebPhone()).webPhone;
      } else {
        await webPhone.start();
      }
      if (cancelled) {
        disposeSharedWebPhoneWhenUnused();
        return;
      }
      retryDelay = 2_000;
      setInboundRegistration({ status: "ready", error: null });
      attachCloseListener();
      for (const callSession of webPhone.callSessions) {
        if (callSession.state === "answered") void callSession.reInvite().catch(() => {});
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (reconnecting) return;
        reconnecting = recover()
          .catch((recoveryError) => {
            retryDelay = Math.min(retryDelay * 2, 60_000);
            onRecoveryFailed(recoveryError);
          })
          .finally(() => {
            reconnecting = null;
          });
      }, retryDelay);
    };

    function onUnexpectedClose() {
      removeCloseListener();
      if (!cancelled && !webPhone?.disposed) {
        setInboundRegistration({
          status: "reconnecting",
          error: "The call connection was interrupted. Retrying automatically."
        });
        scheduleReconnect();
      }
    }

    const onRecoveryFailed = (recoveryError: unknown) => {
      if (cancelled) return;
      setInboundRegistration({
        status: "reconnecting",
        error:
          recoveryError instanceof Error
            ? recoveryError.message
            : "Inbound calling is temporarily unavailable."
      });
      scheduleReconnect();
    };

    const onOnline = () => {
      if (cancelled || reconnecting) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      reconnecting = recover()
        .catch((recoveryError) => {
          retryDelay = Math.min(retryDelay * 2, 60_000);
          onRecoveryFailed(recoveryError);
        })
        .finally(() => {
          reconnecting = null;
        });
    };

    const unsubscribeInbound = subscribeToInboundCalls(handleInboundCall);
    window.addEventListener("online", onOnline);
    void recover().catch(onRecoveryFailed);

    return () => {
      cancelled = true;
      unsubscribeInbound();
      disposeSharedWebPhoneWhenUnused();
      window.removeEventListener("online", onOnline);
      removeCloseListener();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [handleInboundCall, registerInbound]);

  React.useEffect(() => {
    if (!registerInbound) return;
    const primeAudio = () => {
      void primeIncomingCallAudio();
    };
    window.addEventListener("pointerdown", primeAudio, { once: true });
    window.addEventListener("keydown", primeAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", primeAudio);
      window.removeEventListener("keydown", primeAudio);
    };
  }, [registerInbound]);

  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const answerIncomingCall = React.useCallback(async () => {
    const incoming = incomingCall;
    if (!incoming || sessionRef.current !== incoming.session) return;
    setIncomingCall((current) =>
      current?.session === incoming.session
        ? { ...current, actionPending: "answer", error: null }
        : current
    );
    try {
      await ensureMicPermission();
      await incoming.session.answer();
    } catch (answerError) {
      setIncomingCall((current) =>
        current?.session === incoming.session
          ? {
              ...current,
              actionPending: null,
              error: isMicError(answerError)
                ? "Microphone access is required to answer in the CRM."
                : answerError instanceof Error
                  ? answerError.message
                  : "The call could not be answered."
            }
          : current
      );
    }
  }, [incomingCall]);

  const sendIncomingCallToVoicemail = React.useCallback(async () => {
    const incoming = incomingCall;
    if (!incoming || sessionRef.current !== incoming.session) return;
    setIncomingCall((current) =>
      current?.session === incoming.session
        ? { ...current, actionPending: "voicemail", error: null }
        : current
    );
    try {
      await incoming.session.toVoicemail();
      endCall("ended");
    } catch (voicemailError) {
      setIncomingCall((current) =>
        current?.session === incoming.session
          ? {
              ...current,
              actionPending: null,
              error:
                voicemailError instanceof Error
                  ? voicemailError.message
                  : "The call could not be sent to voicemail."
            }
          : current
      );
    }
  }, [endCall, incomingCall]);

  // Signal SIP teardown with the right verb: BYE after answer, CANCEL while ringing.
  // At "init" there is no dialog yet to CANCEL — cleanupSession's dispose() stops the
  // mic + peer connection so no audio can leak even if the INVITE later answers.
  const terminateSession = React.useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      if (session.state === "answered") void session.hangup();
      else if (session.state === "ringing") {
        if (isInboundSession(session)) void session.toVoicemail();
        else void session.cancel();
      }
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
    setDtmfDigits("");
    setRecording(false);
    setIncomingCall(null);
    stopIncomingAlerts();
    setMinimized(false);
    setNotes("");
    setNoteSaved(false);
    setNumber(phone ?? "");
    resetTransferState();
  }, [
    cleanupSession,
    clearConnectTimeout,
    detachAudio,
    finalize,
    phone,
    resetTransferState,
    stopIncomingAlerts,
    stopTimer,
    terminateSession
  ]);

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
    if (next) {
      setMinimized(false);
      setOpen(true);
      return;
    }
    // Closing. A live call must NOT be dropped by a click-outside / Escape — send it
    // to the background bar and keep it running. Only tear down when idle/ended.
    const active = status === "connecting" || status === "ringing" || status === "in-call";
    if (active) {
      setMinimized(true);
      setOpen(false);
      return;
    }
    if (blockCloseRef.current) return;
    reset();
    setOpen(false);
  }

  const startCall = React.useCallback(async (dialOverride?: string) => {
    const dial = toDialString(dialOverride ?? number);
    if (!dial) {
      setError("Enter a valid number to dial.");
      setStatus("error");
      return;
    }
    directionRef.current = "Outbound";
    setDirection("Outbound");
    recordingStartedRef.current = false;
    recordingStartErrorRef.current = undefined;
    consentRef.current = consent;
    setError(null);
    setMuted(false);
    setSeconds(0);
    setDtmfDigits("");
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
      clearConnectTimeout();
      blockCloseRef.current = false;
      setStatus("ringing");
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
  }, [number, consent, attachSession, clearConnectTimeout, endCall, finalize, terminateSession]);

  const hangup = React.useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      if (session.state === "answered") void session.hangup();
      else if (isInboundSession(session)) void session.toVoicemail();
      else void session.cancel();
    } catch {
      // finalize below still tears everything down
    }
    // Finalize synchronously so the trailing 487/BYE-response event can't relabel
    // the outcome (its listeners are removed here).
    endCall("ended");
  }, [endCall]);

  const toggleMute = React.useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (muted) {
      session.unmute();
      setMuted(false);
    } else {
      session.mute();
      setMuted(true);
    }
  }, [muted]);

  const sendDtmf = React.useCallback((key: string) => {
    if (status !== "in-call" || !sessionRef.current || !isDtmfKey(key)) return;
    playDtmfTone(key);
    setDtmfDigits((current) => appendDtmfDigit(current, key));
    try {
      sessionRef.current.sendDtmf(key);
    } catch {
      // Keep the pressed-key feedback visible; the call session owns delivery.
    }
  }, [status]);

  function onDialKey(key: string) {
    if (status === "in-call") {
      sendDtmf(key);
      return;
    }
    if (!isDtmfKey(key)) return;
    playDtmfTone(key);
    setNumber((prev) => prev + key);
  }

  // RingOut fallback: rings the SDR's own phone first, then bridges the lead.
  // Used when the browser softphone can't run (mic denied, no per-SDR line, etc.).
  const ringMyPhoneInstead = React.useCallback(async () => {
    const cid = contactIdRef.current || contactId;
    setError(null);
    blockCloseRef.current = false; // RingOut has no in-flight INVITE to strand
    setStatus("connecting");
    consentRef.current = consent;
    const form = new FormData();
    form.set("contactId", cid);
    form.set("toNumber", number);
    form.set("recordingConsent", consent);
    form.set("requestId", `call-${cid}-${Date.now()}`);
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
  }, [consent, number, contactId]);

  async function saveNote() {
    const body = notes.trim();
    if (!body || noteSaving) return;
    setNoteSaving(true);
    try {
      const form = new FormData();
      form.set("contactId", contactId);
      form.set("title", "Call note");
      form.set("body", body);
      await createNoteAction(form);
      setNoteSaved(true);
    } catch {
      // best-effort; keep the text so the SDR can retry
    } finally {
      setNoteSaving(false);
    }
  }

  const selectTransferTarget = React.useCallback(
    (targetId: string) => {
      setSelectedTransferTargetId(targetId);
      setTransferError(null);
      setTransferMessage(null);

      const target = transferTargets.find((item) => item.id === targetId);
      if (target) {
        setTransferNumber(target.phoneNumber);
      }
    },
    [transferTargets]
  );

  // Typing a custom manager number clears any radio selection (mirrors the dialog).
  const applyTransferNumber = React.useCallback((value: string) => {
    setTransferNumber(value);
    setSelectedTransferTargetId("");
    setTransferError(null);
    setTransferMessage(null);
  }, []);

  const transferCall = React.useCallback(async () => {
    const dial = toDialString(transferNumber);
    if (!dial) {
      setTransferError("Enter a valid manager number to transfer the call.");
      return;
    }

    const session = sessionRef.current as TransferCapableSession | null;
    if (!session || status !== "in-call") {
      setTransferError("Transfer is available after the call is connected.");
      return;
    }
    const domain = sipProvisionDomain ?? session.webPhone?.sipInfo?.domain ?? null;
    const canDomainTransfer = typeof session._transfer === "function" && Boolean(domain);
    if (!canDomainTransfer && typeof session.transfer !== "function") {
      setTransferError("This RingCentral softphone session does not support transfer.");
      return;
    }

    setTransferPending(true);
    setTransferError(null);
    setTransferMessage(null);
    try {
      if (canDomainTransfer) {
        // Mirror the working outbound INVITE: same E.164 number + the account's real
        // SIP domain. The SDK's public transfer() hardcodes sip.ringcentral.com,
        // which RC accepts (dropping the SDR's leg) but can't route on a different
        // edge domain — so the manager never rings. _transfer sets the Refer-To.
        await session._transfer!(`sip:${dial}@${domain}`);
      } else {
        await session.transfer!(dial);
      }
      setTransferMessage("Transfer sent. The SDR call will end when RingCentral completes the handoff.");
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Call transfer failed.");
    } finally {
      setTransferPending(false);
    }
  }, [transferNumber, status]);

  const inLiveCall = status === "connecting" || status === "ringing" || status === "in-call";

  const applyConsent = React.useCallback(
    (next: CallConsent) => {
      setConsent(next);
      consentRef.current = next;
      const session = sessionRef.current;
      if (!session || session.state !== "answered") return;

      if (next === "Granted") {
        startSessionRecording(session);
      } else if (recording) {
        void session.stopRecording().catch(() => {});
        setRecording(false);
        // A later RE-grant must be able to start again. Without this reset,
        // startSessionRecording's already-started guard swallows the restart and
        // the rest of the call is silently unrecorded while consent reads
        // Granted — losing exactly the evidence the consent field protects.
        recordingStartedRef.current = false;
        recordingStartErrorRef.current = undefined;
      }
    },
    [recording, startSessionRecording]
  );

  // Imperative entry points used by SoftphoneButton (dialog) and the Focus dock
  // (inline) via CallProvider. A live call is never dropped: opening the same
  // contact just re-surfaces it; opening while idle sets up a fresh call. Controls
  // are stable useCallbacks, so the handle stays current without ref-during-render.
  React.useImperativeHandle(
    ref,
    () => ({
      openCall(next: CallTarget) {
        const busy = status === "connecting" || status === "ringing" || status === "in-call";
        contactIdRef.current = next.contactId;
        directionRef.current = "Outbound";
        setDirection("Outbound");
        setSurface("dialog");
        setTarget(next);
        setMinimized(false);
        setOpen(true);
        if (!busy) {
          setNumber(next.phone ?? "");
          setStatus("idle");
          setError(null);
          setNotes("");
          setNoteSaved(false);
          setSeconds(0);
          setDtmfDigits("");
          setRecording(false);
          resetTransferState();
        }
      },
      openCallInline(next: CallTarget) {
        const busy = status === "connecting" || status === "ringing" || status === "in-call";
        // One live call at a time — ignore a new inline start while busy so the
        // current call is never dropped.
        if (busy) return;
        contactIdRef.current = next.contactId;
        directionRef.current = "Outbound";
        setDirection("Outbound");
        setSurface("dock");
        setTarget(next);
        setOpen(false);
        setMinimized(false);
        setNumber(next.phone ?? "");
        setError(null);
        setNotes("");
        setNoteSaved(false);
        setSeconds(0);
        setDtmfDigits("");
        setRecording(false);
        resetTransferState();
        // Dial straight away with an explicit number: the setNumber above hasn't
        // committed yet, and contactIdRef (set above) keeps the call log correct.
        void startCall(next.phone);
      },
      hangup,
      toggleMute,
      sendDtmf,
      setConsent: applyConsent,
      retry: () => {
        void startCall();
      },
      reset,
      ringMyPhone: () => {
        void ringMyPhoneInstead();
      },
      loadTransferTargets: () => {
        void loadTransferTargets();
      },
      selectTransferTarget,
      setTransferNumber: applyTransferNumber,
      transferCall: () => {
        void transferCall();
      }
    }),
    [
      status,
      applyConsent,
      hangup,
      reset,
      resetTransferState,
      ringMyPhoneInstead,
      startCall,
      toggleMute,
      sendDtmf,
      loadTransferTargets,
      selectTransferTarget,
      applyTransferNumber,
      transferCall
    ]
  );

  // Report full live-call state up: `busy`/`activeContactId` keep the exact
  // pre-existing meaning for page-level Call buttons; `snapshot` drives the dock.
  React.useEffect(() => {
    onStateChange?.({
      busy: inLiveCall,
      activeContactId: inLiveCall ? contactId : null,
      snapshot: {
        surface,
        status,
        contactId: contactId || null,
        contactName,
        phone: number,
        callerLabel: callerLabel ?? null,
        seconds,
        muted,
        dtmfDigits,
        recording,
        consent,
        error,
        transfer: {
          targets: transferTargets,
          loading: transferTargetsLoading,
          selectedId: selectedTransferTargetId,
          number: transferNumber,
          pending: transferPending,
          error: transferError,
          message: transferMessage
        }
      }
    });
  }, [
    inLiveCall,
    contactId,
    contactName,
    number,
    callerLabel,
    surface,
    status,
    seconds,
    muted,
    dtmfDigits,
    recording,
    consent,
    error,
    transferTargets,
    transferTargetsLoading,
    selectedTransferTargetId,
    transferNumber,
    transferPending,
    transferError,
    transferMessage,
    onStateChange
  ]);

  // The notes editor + save button, reused in the in-call and call-ended views.
  const notesEditor = (
    <div className="w-full text-left">
      <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground" htmlFor="softphone-notes">
        <StickyNote className="size-3.5" aria-hidden="true" />
        Call notes
      </label>
      <textarea
        id="softphone-notes"
        value={notes}
        onChange={(event) => {
          setNotes(event.target.value);
          if (noteSaved) setNoteSaved(false);
        }}
        rows={3}
        placeholder="Jot down what happened on the call…"
        className={cn(fieldTextareaClass, "w-full")}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={saveNote} disabled={!notes.trim() || noteSaving}>
          {noteSaved ? <Check className="size-4" aria-hidden="true" /> : <StickyNote className="size-4" aria-hidden="true" />}
          {noteSaving ? "Saving…" : noteSaved ? "Saved to timeline" : "Save note to timeline"}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {registerInbound && inboundRegistration.status === "reconnecting" && !incomingCall ? (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-[70] flex max-w-sm items-start gap-2 rounded-lg border border-amber-300 bg-popover px-3 py-2.5 shadow-lg"
        >
          <RefreshCw className="mt-0.5 size-4 shrink-0 animate-spin text-amber-600" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-foreground">Inbound calls reconnecting</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {inboundRegistration.error ?? "Retrying automatically. Keep the CRM open."}
            </p>
          </div>
        </div>
      ) : null}

      {incomingCall && direction === "Inbound" && status === "ringing" ? (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="incoming-call-title"
          aria-describedby="incoming-call-number"
          className="fixed right-4 top-20 z-[80] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--teal-200)] bg-popover shadow-2xl"
        >
          <div className="h-1 bg-[var(--teal-600)]" aria-hidden="true" />
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--teal-50)] text-[var(--teal-700)]">
                <span className="absolute inset-0 animate-ping rounded-full bg-[var(--teal-200)] opacity-40" />
                <PhoneIncoming className="relative size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--teal-700)]">
                  Incoming call
                </p>
                <h2 id="incoming-call-title" className="mt-1 truncate text-lg font-semibold text-foreground">
                  {incomingCall.displayName}
                </h2>
                {incomingCall.accountName ? (
                  <p className="truncate text-sm text-muted-foreground">{incomingCall.accountName}</p>
                ) : null}
                <p id="incoming-call-number" className="mt-1 text-sm tabular-nums text-muted-foreground">
                  {incomingCall.phone}
                </p>
                {incomingCall.lookingUp ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                    Matching CRM contact…
                  </p>
                ) : null}
              </div>
            </div>

            {incomingCall.error ? (
              <p className="mt-3 rounded-md bg-[var(--ui-destructive)]/10 px-3 py-2 text-xs text-[var(--ui-destructive)]">
                {incomingCall.error}
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => void answerIncomingCall()}
                disabled={incomingCall.actionPending !== null}
                className="bg-[var(--teal-700)] text-white hover:bg-[var(--teal-800)]"
              >
                {incomingCall.actionPending === "answer" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <PhoneCall aria-hidden="true" />
                )}
                {incomingCall.actionPending === "answer" ? "Answering…" : "Answer"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void sendIncomingCallToVoicemail()}
                disabled={incomingCall.actionPending !== null}
              >
                {incomingCall.actionPending === "voicemail" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Voicemail aria-hidden="true" />
                )}
                Voicemail
              </Button>
            </div>

            {incomingCall.contactId ? (
              <Link
                href={`/crm/contacts/${incomingCall.contactId}`}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--teal-700)] hover:underline"
              >
                Open contact record
                <ExternalLink className="size-3" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <Dialog open={open && surface === "dialog"} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {direction === "Inbound" ? `Incoming call · ${contactName}` : `Call ${contactName}`}
            </DialogTitle>
            <DialogDescription>
              {direction === "Inbound"
                ? `Connected from ${number}. Talk directly in your browser.`
                : `${callerLabel ? `Calling from ${callerLabel}. ` : ""}Talk directly in your browser — no phone rings first.`}
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

              <Button type="button" onClick={() => startCall()} disabled={!number.trim()}>
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
                      ? direction === "Inbound"
                        ? `Incoming call from ${contactName}…`
                        : `Ringing ${contactName}…`
                      : contactName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {status === "in-call" ? formatClock(seconds) : number.trim()}
                </p>
              </div>

              {status === "in-call" ? (
                <div className="flex w-full items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-left">
                  <div>
                    <p className="text-xs font-medium text-foreground">Recording consent</p>
                    <p className="text-[11px] text-muted-foreground">
                      {recording ? "Recording is active" : "Not recording"}
                    </p>
                  </div>
                  <select
                    value={consent}
                    onChange={(event) => applyConsent(event.target.value as CallConsent)}
                    className={cn(fieldClass, "h-8 w-28")}
                    aria-label="Recording consent"
                  >
                    {CONSENTS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {status === "in-call" ? (
                <div className="w-full">
                  <div
                    className="mb-2 min-h-9 rounded-md border bg-muted/40 px-3 py-2 text-center font-mono text-sm tracking-[0.18em] text-foreground"
                    aria-live="polite"
                    aria-label="DTMF digits pressed"
                  >
                    {dtmfDigits || <span className="font-sans tracking-normal text-muted-foreground">Pressed digits appear here</span>}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {DIAL_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onDialKey(key)}
                        aria-label={`Send keypad ${key}`}
                        className="bg-card hover:bg-[var(--bg-subtle)] h-9 rounded-md border text-sm font-medium text-foreground transition-all active:scale-95 active:bg-muted"
                      >
                        {key}
                      </button>
                    ))}
                  </div>
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMinimized(true);
                    setOpen(false);
                  }}
                  title="Keep the call running in the background"
                >
                  <Minimize2 aria-hidden="true" />
                  Minimize
                </Button>
              </div>

              {status === "in-call" ? (
                <div className="w-full rounded-md border bg-muted/40 p-3 text-left">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="transfer-target">
                      Transfer to manager
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void loadTransferTargets()}
                      disabled={transferTargetsLoading || transferPending}
                      aria-label="Refresh transfer targets"
                      title="Refresh"
                    >
                      <RefreshCw className={cn("size-4", transferTargetsLoading && "animate-spin")} aria-hidden="true" />
                    </Button>
                  </div>
                  {transferTargets.length ? (
                    <select
                      id="transfer-target"
                      value={selectedTransferTargetId}
                      onChange={(event) => selectTransferTarget(event.target.value)}
                      className={cn(fieldClass, "h-9 w-full")}
                      disabled={transferPending}
                    >
                      <option value="">Custom number</option>
                      {transferTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {transferTargetsLoading ? "Loading managers..." : "No manager RingCentral line configured."}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={transferNumber}
                      onChange={(event) => {
                        setTransferNumber(event.target.value);
                        setSelectedTransferTargetId("");
                        setTransferError(null);
                        setTransferMessage(null);
                      }}
                      inputMode="tel"
                      aria-label="Transfer number"
                      className={cn(fieldClass, "h-9 min-w-0 flex-1")}
                      placeholder="+1 (___) ___-____"
                      disabled={transferPending}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={transferCall}
                      disabled={transferPending || !transferNumber.trim()}
                    >
                      {transferPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PhoneForwarded aria-hidden="true" />}
                      Transfer
                    </Button>
                  </div>
                  {transferError ? <p className="mt-2 text-xs text-[var(--ui-destructive)]">{transferError}</p> : null}
                  {transferMessage ? <p className="mt-2 text-xs text-muted-foreground">{transferMessage}</p> : null}
                </div>
              ) : null}

              {notesEditor}
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
              {status === "ended" ? notesEditor : null}
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                {status === "error" ? (
                  <>
                    <Button type="button" size="sm" onClick={() => startCall()}>
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

      {/* Backgrounded call: a floating bar so the call keeps running while the SDR
          works elsewhere on the page. Expand reopens the dialog. Dock-surface calls
          use the persistent dock instead, so the bar is dialog-only. */}
      {minimized && inLiveCall && surface === "dialog" ? (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-full border bg-popover px-4 py-2 shadow-lg">
          <span className="relative flex size-2.5" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--teal-700)] opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-[var(--teal-700)]" />
          </span>
          <div className="min-w-0 text-left">
            <p className="truncate text-sm font-medium text-foreground">{contactName}</p>
            <p className="text-xs text-muted-foreground">
              {status === "in-call"
                ? `On call · ${formatClock(seconds)}`
                : status === "ringing"
                  ? "Ringing…"
                  : "Connecting…"}
            </p>
          </div>
          {status === "in-call" ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => {
              setMinimized(false);
              setOpen(true);
            }}
            aria-label="Expand call"
            title="Expand"
          >
            <Maximize2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            className="bg-[var(--ui-destructive)] text-white hover:opacity-90"
            onClick={hangup}
            disabled={status === "connecting"}
            aria-label="Hang up"
            title="Hang up"
          >
            <PhoneOff aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </>
  );
});

/**
 * Thin, per-contact Call button. It does not own the call — it asks the global
 * call engine (mounted once in the root layout via CallProvider) to place it, so
 * the live call survives navigating between pages.
 */
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
  const { openCall, busy, activeContactId } = useCall();
  const onThisCall = activeContactId === contactId;
  // Block starting a second call while one is live (return to the active one instead).
  const disabled = Boolean(blockReason) || !phone || (busy && !onThisCall);
  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? "icon-sm" : size}
      className={className}
      disabled={disabled}
      title={
        blockReason ??
        (!phone
          ? "No phone number on file"
          : busy && !onThisCall
            ? "Finish your current call first"
            : onThisCall
              ? "Return to call"
              : `Call ${contactName}`)
      }
      aria-label={iconOnly ? `Call ${contactName}` : undefined}
      onClick={() => openCall({ contactId, contactName, phone, callerLabel, blockReason })}
    >
      <Phone aria-hidden="true" />
      {iconOnly ? null : onThisCall ? "On call" : label}
    </Button>
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
