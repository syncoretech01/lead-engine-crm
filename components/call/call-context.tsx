"use client";

import * as React from "react";

/** The contact a call is placed to. Passed from a SoftphoneButton (dialog) or the
 *  Focus dock (inline) to the global call engine so the engine (not the per-page
 *  surface) owns the live session. */
export type CallTarget = {
  contactId: string;
  contactName: string;
  phone?: string;
  callerLabel?: string;
  blockReason?: string;
};

export type CallStatus = "idle" | "connecting" | "ringing" | "in-call" | "ended" | "error" | "ringout-done";
/** Which surface owns the current call: the legacy modal dialog (per-page
 *  SoftphoneButtons) or the docked panel (the Focus cockpit). */
export type CallSurface = "dialog" | "dock";
export type CallConsent = "Granted" | "Denied" | "Unknown";

/** A manager RingCentral line the SDR can warm/blind transfer a live call to. */
export type CallTransferTarget = {
  id: string;
  name: string;
  email: string;
  role: string;
  phoneNumber: string;
  label: string;
};

/** Transfer-to-manager sub-state (published inside the snapshot). */
export type CallTransferState = {
  targets: CallTransferTarget[];
  loading: boolean;
  selectedId: string;
  number: string;
  pending: boolean;
  error: string | null;
  message: string | null;
};

/** The full live-call state the engine publishes on every change. The Focus dock
 *  renders entirely from this snapshot (§State Management: "dock renders from its
 *  state-change callback"); the dialog surface keeps its own internal state. */
export type CallSnapshot = {
  surface: CallSurface;
  status: CallStatus;
  contactId: string | null;
  contactName: string;
  phone: string;
  callerLabel: string | null;
  seconds: number;
  muted: boolean;
  recording: boolean;
  consent: CallConsent;
  error: string | null;
  transfer: CallTransferState;
};

/** Imperative controls the dock drives the live call with. Each proxies to the
 *  single mounted SoftphoneEngine. */
export type CallControls = {
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

export type CallContextValue = {
  /** Open the modal call dialog for a contact (legacy per-page buttons). */
  openCall: (target: CallTarget) => void;
  /** Start a call rendered inline in the Focus dock (no modal). */
  openCallInline: (target: CallTarget) => void;
  /** The contact of the current live call, or null when idle. */
  activeContactId: string | null;
  /** True while a call is connecting/ringing/in progress. */
  busy: boolean;
  /** Full live-call snapshot (drives the dock's state machine). */
  call: CallSnapshot;
  controls: CallControls;
};

export const IDLE_TRANSFER_STATE: CallTransferState = {
  targets: [],
  loading: false,
  selectedId: "",
  number: "",
  pending: false,
  error: null,
  message: null
};

export const IDLE_CALL_SNAPSHOT: CallSnapshot = {
  surface: "dialog",
  status: "idle",
  contactId: null,
  contactName: "",
  phone: "",
  callerLabel: null,
  seconds: 0,
  muted: false,
  recording: false,
  consent: "Granted",
  error: null,
  transfer: IDLE_TRANSFER_STATE
};

const NOOP_CONTROLS: CallControls = {
  hangup: () => {},
  toggleMute: () => {},
  sendDtmf: () => {},
  setConsent: () => {},
  retry: () => {},
  reset: () => {},
  ringMyPhone: () => {},
  loadTransferTargets: () => {},
  selectTransferTarget: () => {},
  setTransferNumber: () => {},
  transferCall: () => {}
};

export const CallContext = React.createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = React.useContext(CallContext);
  // Fall back to a no-op when no provider is mounted (e.g. isolated tests) so
  // call buttons never crash.
  return (
    ctx ?? {
      openCall: () => {},
      openCallInline: () => {},
      activeContactId: null,
      busy: false,
      call: IDLE_CALL_SNAPSHOT,
      controls: NOOP_CONTROLS
    }
  );
}
