"use client";

import * as React from "react";

/** The contact a call is placed to. Passed from a SoftphoneButton to the global
 *  call engine so the engine (not the per-page button) owns the live session. */
export type CallTarget = {
  contactId: string;
  contactName: string;
  phone?: string;
  callerLabel?: string;
  blockReason?: string;
};

export type CallContextValue = {
  /** Open the global call dialog for a contact (starts the softphone flow). */
  openCall: (target: CallTarget) => void;
  /** The contact of the current live call, or null when idle. */
  activeContactId: string | null;
  /** True while a call is connecting/ringing/in progress. */
  busy: boolean;
};

export const CallContext = React.createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = React.useContext(CallContext);
  // Fall back to a no-op when no provider is mounted (e.g. isolated tests) so
  // call buttons never crash.
  return ctx ?? { openCall: () => {}, activeContactId: null, busy: false };
}
