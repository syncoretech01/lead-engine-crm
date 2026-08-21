import Link from "next/link";
import { CalendarDays, ListChecks } from "lucide-react";

import { fieldClass } from "@/components/ui/field";
import { FollowUpsTable } from "@/components/crm/follow-ups-table";
import {
  groupFollowUpsByContact,
  readFastFollowUpsModel,
  type FollowUpContactRow
} from "@/lib/phase1/follow-ups-read-model";
import { followUpSourceRowsSnapshot, sdrUsers } from "@/lib/phase1/sdr";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatNumber, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type CounterTone = "blue" | "teal" | "amber";

/**
 * Follow-ups: the contacts an SDR has actually scheduled work against. Only
 * contacts with at least one open follow-up appear — the system "First touch …"
 * reminders that assignment creates are excluded, so this is scheduled work, not
 * the SLA clock (that lives on My Day). SDRs see their own; a Manager/Admin sees
 * the whole workspace and can narrow to one SDR.
 */
export default async function FollowUpsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; sort?: string; page?: string; sdr?: string }>;
}) {
  const sp = await searchParams;
  const sessionContext = await getWorkspaceSessionContext("manage_sdr");
  let { session, workspaceId } = sessionContext;
  const isSdr = session.role === "SDR";
  const selectedSdrId = isSdr ? undefined : sp.sdr && sp.sdr !== "all" ? sp.sdr : undefined;

  let rows: FollowUpContactRow[];
  let roster: Array<{ id: string; name: string }>;
  let truncated = false;

  const fastModel = await readFastFollowUpsModel(session, workspaceId, { sdrId: selectedSdrId });
  if (fastModel) {
    rows = fastModel.rows;
    roster = fastModel.roster;
    truncated = fastModel.truncated;
  } else {
    const {
      state,
      session: fallbackSession,
      workspaceId: fallbackWorkspaceId
    } = await getWorkspaceContext("manage_sdr");
    session = fallbackSession;
    workspaceId = fallbackWorkspaceId;
    const ownerId = session.role === "SDR" ? session.user.id : selectedSdrId;
    rows = groupFollowUpsByContact(followUpSourceRowsSnapshot(state, workspaceId, ownerId));
    roster =
      session.role === "SDR"
        ? []
        : sdrUsers(state, workspaceId).map((user) => ({ id: user.id, name: user.name }));
  }

  const totalFollowUps = rows.reduce((total, row) => total + row.openFollowUps, 0);
  const overdueContacts = rows.filter((row) => row.overdueFollowUps > 0).length;
  const meetingContacts = rows.filter((row) => row.nextChannel === "Meeting").length;

  const counters: Array<{ tone: CounterTone; label: string; value: number }> = [
    { tone: "blue", label: "Contacts with follow-ups", value: rows.length },
    { tone: "blue", label: "Open follow-ups", value: totalFollowUps },
    { tone: "teal", label: "Meetings next", value: meetingContacts },
    { tone: overdueContacts ? "amber" : "teal", label: "Overdue", value: overdueContacts }
  ];

  return (
    <div className="cockpit min-h-full min-w-0 bg-co-page">
      <div className="mx-auto w-full min-w-0 max-w-[1280px] px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-co-blue">CRM · Records</div>
            <h1 className="mt-0.5 text-[22px] font-extrabold text-co-ink">Follow-ups</h1>
            <p className="mt-0.5 max-w-[660px] text-[12.5px] text-co-text-3">
              {isSdr
                ? "Only the contacts you have scheduled a follow-up for, soonest first. Complete one here and it clears from your day."
                : "Only the contacts an SDR has scheduled a follow-up for, soonest first. Filter by SDR to see one rep's committed work."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/sdr/calendar"
              className="flex h-[38px] items-center gap-2 rounded-[9px] border border-co-control bg-co-surface px-4 text-[13px] font-bold text-co-text-3 transition-colors hover:bg-co-sunken"
            >
              <CalendarDays className="size-4" aria-hidden="true" />
              Calendar
            </Link>
            <Link
              href="/sdr/queue"
              className="flex h-[38px] items-center gap-2 rounded-[9px] bg-co-blue px-4 text-[13px] font-bold text-white transition-colors hover:bg-co-blue-hover"
            >
              <ListChecks className="size-4" aria-hidden="true" />
              {isSdr ? "My Day" : "SDR queue"}
            </Link>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 divide-y divide-co-divider rounded-[10px] border border-co-border bg-co-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {counters.map((counter) => (
            <Counter key={counter.label} tone={counter.tone} label={counter.label} value={counter.value} />
          ))}
        </div>

        <section className="mt-5 min-w-0 overflow-hidden rounded-[10px] border border-co-border bg-co-surface">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-co-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-[13px] font-extrabold text-co-ink">Scheduled follow-ups</h2>
              <p className="mt-0.5 text-[11.5px] text-co-text-3">
                One row per contact showing the soonest open follow-up. System first-touch reminders are not
                shown — those live on My Day.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!isSdr && roster.length ? (
                <form action="/crm/follow-ups" method="get" className="flex items-center gap-2">
                  <label htmlFor="follow-up-owner" className="text-[11px] font-bold text-co-text-3">
                    SDR
                  </label>
                  <select
                    id="follow-up-owner"
                    name="sdr"
                    defaultValue={selectedSdrId ?? "all"}
                    className={cn(fieldClass, "h-8 w-44 border-co-control bg-co-surface text-co-ink")}
                  >
                    <option value="all">All SDRs</option>
                    {roster.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="h-8 rounded-[8px] border border-co-control bg-co-surface px-3 text-[11.5px] font-bold text-co-text-3 transition-colors hover:bg-co-sunken"
                  >
                    Apply
                  </button>
                </form>
              ) : null}
              <span className="rounded-full bg-co-sunken px-2.5 py-1 text-[11px] font-bold text-co-text-3 ring-1 ring-inset ring-co-border">
                {formatNumber(rows.length)} contacts
              </span>
            </div>
          </div>
          {truncated ? (
            <p className="border-b border-co-border bg-co-sunken px-4 py-2 text-[11.5px] font-bold text-co-text-3">
              Showing the soonest 2,000 open follow-ups — narrow by SDR to see the rest.
            </p>
          ) : null}
          <FollowUpsTable
            rows={rows}
            isSdr={isSdr}
            initialQuery={sp.q}
            initialSort={sp.sort}
            initialPage={sp.page ? Math.max(0, Number(sp.page) - 1) : undefined}
          />
        </section>
      </div>
    </div>
  );
}

const dotTone: Record<CounterTone, string> = {
  blue: "bg-co-blue",
  teal: "bg-co-teal",
  amber: "bg-co-amber-dot"
};

function Counter({ tone, label, value }: { tone: CounterTone; label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className={`size-2 rounded-full ${dotTone[tone]}`} aria-hidden="true" />
        <span className="text-[11px] font-bold text-co-text-3">{label}</span>
      </div>
      <span className="text-[22px] font-extrabold tabular-nums text-co-ink">{formatNumber(value)}</span>
    </div>
  );
}
