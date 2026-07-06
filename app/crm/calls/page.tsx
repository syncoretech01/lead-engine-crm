import Link from "next/link";
import { Clock, PhoneCall, PhoneMissed } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { RecordingPlayer } from "@/components/recording-player";
import { Button, buttonVariants } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import { sdrUsers } from "@/lib/phase1/sdr";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { cn, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CallsPage({
  searchParams
}: {
  searchParams: Promise<{ sdr?: string }>;
}) {
  const { sdr } = await searchParams;
  const { state, session, workspaceId } = await getWorkspaceContext("manage_sdr");
  const isSdr = session.role === "SDR";
  const sdrFilter = isSdr ? session.user.id : sdr || undefined;

  const calls = state.trackedCalls
    .filter((call) => call.workspaceId === workspaceId)
    .filter((call) => !sdrFilter || call.sdrUserId === sdrFilter)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 200);

  const contactName = (id: string) => {
    const contact = state.contacts.find((item) => item.id === id && item.workspaceId === workspaceId);
    return contact ? displayContactName(contact) : "Unknown contact";
  };
  const userName = (id: string) => state.users.find((user) => user.id === id)?.name ?? "—";
  const roster = isSdr ? [] : sdrUsers(state, workspaceId).map((user) => ({ id: user.id, name: user.name }));

  const connected = calls.filter((call) => call.callStatus === "Connected").length;
  const recordings = calls.filter((call) => Boolean(call.recordingId)).length;

  return (
    <>
      <PageHeader
        kicker="CRM Execution"
        title={isSdr ? "My calls" : "Call log"}
        copy={
          isSdr
            ? "Every call you've placed — number, duration, outcome, and the recording once it's ready."
            : "Calls placed across the SDR team, with duration, outcome, and recordings."
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/crm/my-contacts">Assigned contacts</Link>
          </Button>
        }
      />

      <section aria-label="Call metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={PhoneCall} tone="info" label="Calls" value={formatNumber(calls.length)} note="Most recent 200" />
        <StatCard icon={Clock} tone="success" label="Connected" value={formatNumber(connected)} note="Reached the contact" />
        <StatCard
          icon={PhoneMissed}
          tone={recordings > 0 ? "success" : "default"}
          label="Recordings"
          value={formatNumber(recordings)}
          note="Available to play"
        />
      </section>

      <Panel
        title="Call log"
        subtitle="Newest calls first."
        action={
          !isSdr && roster.length > 0 ? (
            <form method="get" className="flex items-center gap-2">
              <label className="sr-only" htmlFor="sdr-filter">
                Filter by SDR
              </label>
              <select id="sdr-filter" name="sdr" defaultValue={sdrFilter ?? ""} className={cn(fieldClass, "h-8 w-44")}>
                <option value="">All SDRs</option>
                {roster.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Filter
              </button>
            </form>
          ) : (
            <StatusBadge label={`${formatNumber(calls.length)} calls`} tone="info" />
          )
        }
        flush
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Outcome</TableHead>
              {!isSdr ? <TableHead>SDR</TableHead> : null}
              <TableHead>When</TableHead>
              <TableHead>Recording</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((call) => (
              <TableRow key={call.id}>
                <TableCell>
                  {call.contactId ? (
                    <Link href={`/crm/contacts/${call.contactId}`} className="font-medium text-foreground">
                      {contactName(call.contactId)}
                    </Link>
                  ) : (
                    <span className="text-foreground">Unknown contact</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{call.phoneNumber || "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDuration(call.durationSeconds)}
                </TableCell>
                <TableCell>
                  <StatusBadge label={dispositionLabel(call.callStatus, call.disposition)} tone={outcomeTone(call.callStatus)} />
                </TableCell>
                {!isSdr ? <TableCell className="text-muted-foreground">{userName(call.sdrUserId)}</TableCell> : null}
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(call.createdAt)}</TableCell>
                <TableCell>{recordingCell(call.recordingId, call.recordingConsent, call.createdAt, call.id)}</TableCell>
              </TableRow>
            ))}
            {calls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isSdr ? 6 : 7} className="text-muted-foreground">
                  {isSdr ? "You haven't placed any calls yet." : "No calls logged yet."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Panel>
    </>
  );
}

function recordingCell(recordingId: string | undefined, consent: string, createdAt: string, callId: string) {
  if (recordingId) {
    return <RecordingPlayer callId={callId} />;
  }
  if (consent === "Granted") {
    // Recorded on-demand; the reconcile worker pulls the recording once RingCentral
    // finishes processing it. After ~30 min with nothing, assume it never landed.
    const ageMs = Date.now() - Date.parse(createdAt);
    return (
      <span className="text-xs text-muted-foreground">
        {Number.isFinite(ageMs) && ageMs < 30 * 60 * 1000 ? "Processing…" : "Unavailable"}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function dispositionLabel(callStatus: string, disposition: string): string {
  if (callStatus === "Dialed") return "Placed";
  if (callStatus === "Connected") return disposition && disposition !== "No answer" ? disposition : "Connected";
  return callStatus;
}

function outcomeTone(callStatus: string): BadgeTone {
  if (callStatus === "Connected") return "success";
  if (callStatus === "Failed" || callStatus === "Busy") return "danger";
  if (callStatus === "No answer" || callStatus === "Voicemail") return "warning";
  return "info";
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
