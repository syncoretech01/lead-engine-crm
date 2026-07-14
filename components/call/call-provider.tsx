"use client";

import * as React from "react";
import {
  CallContext,
  IDLE_CALL_SNAPSHOT,
  type CallConsent,
  type CallContextValue,
  type CallControls,
  type CallSnapshot,
  type CallTarget
} from "@/components/call/call-context";
import { SoftphoneEngine, type SoftphoneEngineHandle } from "@/components/softphone-button";

/**
 * Mounts the softphone engine ONCE, above the page tree (in the root layout), so
 * a live call survives client-side navigation between pages. Per-page
 * SoftphoneButtons place calls through `openCall` (modal dialog); the Focus dock
 * places them through `openCallInline` and renders the call from `call` (the
 * engine's published snapshot) + drives it through `controls`. The engine owns
 * the WebRTC session either way.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const engineRef = React.useRef<SoftphoneEngineHandle>(null);
  const [busy, setBusy] = React.useState(false);
  const [activeContactId, setActiveContactId] = React.useState<string | null>(null);
  const [snapshot, setSnapshot] = React.useState<CallSnapshot>(IDLE_CALL_SNAPSHOT);

  const openCall = React.useCallback((target: CallTarget) => {
    engineRef.current?.openCall(target);
  }, []);

  const openCallInline = React.useCallback((target: CallTarget) => {
    engineRef.current?.openCallInline(target);
  }, []);

  const onStateChange = React.useCallback(
    (state: { busy: boolean; activeContactId: string | null; snapshot: CallSnapshot }) => {
      setBusy(state.busy);
      setActiveContactId(state.activeContactId);
      setSnapshot(state.snapshot);
    },
    []
  );

  const controls = React.useMemo<CallControls>(
    () => ({
      hangup: () => engineRef.current?.hangup(),
      toggleMute: () => engineRef.current?.toggleMute(),
      sendDtmf: (key: string) => engineRef.current?.sendDtmf(key),
      setConsent: (consent: CallConsent) => engineRef.current?.setConsent(consent),
      retry: () => engineRef.current?.retry(),
      reset: () => engineRef.current?.reset(),
      ringMyPhone: () => engineRef.current?.ringMyPhone(),
      loadTransferTargets: () => engineRef.current?.loadTransferTargets(),
      selectTransferTarget: (id: string) => engineRef.current?.selectTransferTarget(id),
      setTransferNumber: (value: string) => engineRef.current?.setTransferNumber(value),
      transferCall: () => engineRef.current?.transferCall()
    }),
    []
  );

  const value = React.useMemo<CallContextValue>(
    () => ({ openCall, openCallInline, busy, activeContactId, call: snapshot, controls }),
    [openCall, openCallInline, busy, activeContactId, snapshot, controls]
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <SoftphoneEngine ref={engineRef} onStateChange={onStateChange} />
    </CallContext.Provider>
  );
}
