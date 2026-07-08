"use client";

import * as React from "react";
import { CallContext, type CallContextValue, type CallTarget } from "@/components/call/call-context";
import { SoftphoneEngine, type SoftphoneEngineHandle } from "@/components/softphone-button";

/**
 * Mounts the softphone engine ONCE, above the page tree (in the root layout), so
 * a live call survives client-side navigation between pages. Per-page
 * SoftphoneButtons place calls through the context's `openCall`; the engine owns
 * the WebRTC session, the dialog, and the floating background bar.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const engineRef = React.useRef<SoftphoneEngineHandle>(null);
  const [busy, setBusy] = React.useState(false);
  const [activeContactId, setActiveContactId] = React.useState<string | null>(null);

  const openCall = React.useCallback((target: CallTarget) => {
    engineRef.current?.openCall(target);
  }, []);

  const onStateChange = React.useCallback(
    (state: { busy: boolean; activeContactId: string | null }) => {
      setBusy(state.busy);
      setActiveContactId(state.activeContactId);
    },
    []
  );

  const value = React.useMemo<CallContextValue>(
    () => ({ openCall, busy, activeContactId }),
    [openCall, busy, activeContactId]
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <SoftphoneEngine ref={engineRef} onStateChange={onStateChange} />
    </CallContext.Provider>
  );
}
