import { outreachTrackedCallWriteTables } from "@/lib/phase1/normalized-write-tables";
import { readState, updateAuthState } from "@/lib/phase1/store";
import {
  normalizeServerUrl,
  requestRingCentralAccessToken,
  ringCentralCredentialFromEnv,
  ringCentralSmsLiveBlockReason
} from "@/lib/providers/adapters/ringcentral-sms";

// How far back we reconcile. A softphone call records on-demand
// (session.startRecording()); RingCentral then needs a little time to make the
// recording queryable in the call log, so we keep re-checking recent calls.
const RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000;
// Bounds how deep we page the call log in one tick (250/page) so a busy account
// can't strand a recording behind the first page, without unbounded fetching.
const MAX_CALL_LOG_PAGES = 10;

export type RecordingWorkerTick = { scanned: number; matched: number; updated: number };

type CallLogRecord = {
  telephonySessionId?: string;
  recording?: { id?: string } | null;
};

/**
 * Reconciles recorded softphone calls with their RingCentral recording id.
 * Session-less (runs under `updateAuthState`, like the other workers).
 *
 * A softphone call with consent "Granted" records on-demand and stores its RC
 * telephony session id on the TrackedCall. This tick pulls the recent account
 * call log (admin credential, account-wide) and, for any consented+connected
 * call still missing a `recordingId`, copies the matching `recording.id` across.
 * The play button then streams that recording via `/api/recordings/[id]`.
 */
export async function runRecordingWorkerTick(
  options: { workspaceId?: string } = {}
): Promise<RecordingWorkerTick> {
  const state = await readState();
  const now = Date.now();
  const pending = state.trackedCalls.filter(
    (call) =>
      (!options.workspaceId || call.workspaceId === options.workspaceId) &&
      call.recordingConsent === "Granted" &&
      call.callStatus === "Connected" &&
      Boolean(call.telephonySessionId) &&
      !call.recordingId &&
      now - Date.parse(call.createdAt) < RECONCILE_WINDOW_MS
  );
  if (pending.length === 0) {
    return { scanned: 0, matched: 0, updated: 0 };
  }

  const blockReason = ringCentralSmsLiveBlockReason();
  const credential = ringCentralCredentialFromEnv();
  if (blockReason || !credential) {
    console.warn(
      `[recording-worker] ${pending.length} call(s) awaiting a recording, but the live path is unavailable: ${blockReason ?? "no RingCentral credential"}`
    );
    return { scanned: pending.length, matched: 0, updated: 0 };
  }

  const serverUrl = normalizeServerUrl(credential.serverUrl);
  const pendingSessions = new Set(
    pending.map((call) => call.telephonySessionId).filter((id): id is string => Boolean(id))
  );
  const bySession = new Map<string, string>();
  // Diagnostics: which pending sessions RingCentral's call log actually knows
  // about, so a persistent 0-match can be attributed (not-in-log vs in-log-but-
  // no-recording vs fetch-failed) instead of failing silently.
  const seenSessions = new Set<string>();
  let logRecordsScanned = 0;
  try {
    const token = await requestRingCentralAccessToken(serverUrl, credential, fetch);
    const dateFrom = new Date(now - RECONCILE_WINDOW_MS).toISOString();
    let nextUri: string | undefined =
      `${serverUrl}/restapi/v1.0/account/~/call-log` +
      `?view=Detailed&perPage=250&recordingType=All&dateFrom=${encodeURIComponent(dateFrom)}`;
    // Follow the call log's paging until every pending session is matched, the
    // pages run out, or we hit the cap — no silent truncation at 250 records.
    for (let page = 0; nextUri && bySession.size < pendingSessions.size && page < MAX_CALL_LOG_PAGES; page += 1) {
      const res = await fetch(nextUri, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `[recording-worker] call-log fetch failed: HTTP ${res.status} ${res.statusText}. ` +
            `A 403 usually means the RingCentral app is missing the ReadCallLog/ReadCallRecording scope. ${body.slice(0, 200)}`
        );
        return { scanned: pending.length, matched: 0, updated: 0 };
      }
      const json = (await res.json()) as {
        records?: CallLogRecord[];
        navigation?: { nextPage?: { uri?: string } };
      };
      const records = json.records ?? [];
      logRecordsScanned += records.length;
      for (const record of records) {
        if (!record.telephonySessionId || !pendingSessions.has(record.telephonySessionId)) continue;
        seenSessions.add(record.telephonySessionId);
        if (record.recording?.id) {
          bySession.set(record.telephonySessionId, record.recording.id);
        }
      }
      nextUri = json.navigation?.nextPage?.uri;
    }
  } catch (error) {
    // transient (network/auth); the next tick retries — but say so.
    console.warn(
      `[recording-worker] call-log fetch error: ${error instanceof Error ? error.message : String(error)}`
    );
    return { scanned: pending.length, matched: 0, updated: 0 };
  }

  const matched = pending.filter((call) => call.telephonySessionId && bySession.has(call.telephonySessionId));

  // When a candidate can't be matched, attribute the reason so a stuck recording
  // is diagnosable from the logs instead of an opaque `recordings=0/1`.
  if (matched.length < pending.length) {
    const notInLog = [...pendingSessions].filter((id) => !seenSessions.has(id));
    const inLogNoRecording = [...seenSessions].filter((id) => !bySession.has(id));
    console.warn(
      `[recording-worker] ${pending.length} pending, ${matched.length} matched ` +
        `(call-log records scanned=${logRecordsScanned}). ` +
        `sessions absent from call log=${notInLog.length}${notInLog.length ? ` [${notInLog.slice(0, 3).join(", ")}]` : ""}; ` +
        `present but no recording.id=${inLogNoRecording.length}${inLogNoRecording.length ? ` [${inLogNoRecording.slice(0, 3).join(", ")}]` : ""}. ` +
        `>0 "no recording.id" ⇒ on-demand recording never started (RC On-Demand Call Recording / scope). ` +
        `>0 "absent" ⇒ session-id mismatch or the call hasn't landed in the call log yet.`
    );
  }

  if (matched.length === 0) {
    return { scanned: pending.length, matched: 0, updated: 0 };
  }

  const updated = await updateAuthState(
    (draft) => {
      let count = 0;
      for (const call of draft.trackedCalls) {
        if (call.recordingId || !call.telephonySessionId) continue;
        const recordingId = bySession.get(call.telephonySessionId);
        if (recordingId) {
          call.recordingId = recordingId;
          count += 1;
        }
      }
      return count;
    },
    { normalizedTables: outreachTrackedCallWriteTables }
  );

  return { scanned: pending.length, matched: matched.length, updated };
}
