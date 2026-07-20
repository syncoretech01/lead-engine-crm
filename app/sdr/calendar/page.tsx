import Link from "next/link";
import { CalendarCheck2, ChevronLeft, ChevronRight, Clock3, ListChecks, Users } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import {
  buildSdrCalendarDays,
  dateKeyInTimeZone,
  isSdrScheduledFollowUp,
  resolveSdrCalendarMonth
} from "@/lib/phase1/sdr-calendar";
import { readFastSdrQueueModel, type SdrQueueReminderReadRow } from "@/lib/phase1/sdr-queue-read-model";
import { sdrQueueSnapshot, sdrUsers } from "@/lib/phase1/sdr";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { User } from "@/lib/phase1/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type CalendarReminder = Pick<
  SdrQueueReminderReadRow,
  "id" | "contactId" | "ownerUserId" | "title" | "channel" | "dueAt" | "status" | "companyName"
>;

export default async function SdrCalendarPage({
  searchParams
}: {
  searchParams: Promise<{ month?: string; sdr?: string }>;
}) {
  const params = await searchParams;
  const sessionContext = await getWorkspaceSessionContext("manage_sdr");
  const { session, workspaceId } = sessionContext;
  const fastModel = await readFastSdrQueueModel(session, workspaceId);
  let reminders: CalendarReminder[];
  let roster: User[];

  if (fastModel) {
    reminders = fastModel.snapshot.reminders;
    roster = fastModel.bulkOwnerUsers;
  } else {
    const { state } = await getWorkspaceContext("manage_sdr");
    const snapshot = sdrQueueSnapshot(state, workspaceId, session.role === "SDR" ? session.user.id : undefined);
    reminders = snapshot.reminders;
    roster = sdrUsers(state, workspaceId);
  }

  const selectableSdrs = session.role === "SDR" ? [session.user] : uniqueUsers(roster);
  const selectedSdr =
    selectableSdrs.find((user) => user.id === params.sdr) ??
    selectableSdrs.find((user) => user.id === session.user.id) ??
    selectableSdrs[0] ??
    session.user;
  const timeZone = selectedSdr.timezone || "UTC";
  const month = resolveSdrCalendarMonth(params.month, new Date(), timeZone);
  const days = buildSdrCalendarDays(month);
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  const events = reminders
    .filter(
      (reminder) =>
        reminder.ownerUserId === selectedSdr.id &&
        reminder.status !== "Completed" &&
        isSdrScheduledFollowUp(reminder)
    )
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));
  const monthEvents = events.filter((reminder) => dateKeyInTimeZone(reminder.dueAt, timeZone).startsWith(month.key));
  const eventsByDay = new Map<string, CalendarReminder[]>();
  for (const reminder of monthEvents) {
    const key = dateKeyInTimeZone(reminder.dueAt, timeZone);
    const list = eventsByDay.get(key) ?? [];
    list.push(reminder);
    eventsByDay.set(key, list);
  }
  const managerView = session.role !== "SDR";
  const overdueCount = monthEvents.filter((event) => event.status === "Overdue").length;
  const meetingCount = monthEvents.filter((event) => event.channel === "Meeting").length;

  return (
    <div className="cockpit min-h-full bg-co-page">
      <div className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-co-blue">CRM · SDR Workspace</div>
            <h1 className="mt-0.5 text-[22px] font-extrabold text-co-ink">Calendar</h1>
            <p className="mt-0.5 text-[12.5px] text-co-text-3">
              {selectedSdr.name}&apos;s scheduled follow-ups · {friendlyTimeZone(timeZone)}
            </p>
          </div>
          <Link
            href="/sdr/queue"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-co-border bg-co-surface px-3 text-[12px] font-bold text-co-ink transition-colors hover:bg-co-hover"
          >
            <ListChecks className="size-4 text-co-blue" aria-hidden="true" />
            Back to My Day
          </Link>
        </header>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CalendarStat label="Scheduled this month" value={monthEvents.length} icon={CalendarCheck2} tone="blue" />
          <CalendarStat label="Meetings" value={meetingCount} icon={Users} tone="teal" />
          <CalendarStat label="Overdue" value={overdueCount} icon={Clock3} tone="red" />
        </div>

        <section className="mt-5 overflow-hidden rounded-[10px] border border-co-border bg-co-surface">
          <div className="flex flex-col gap-3 border-b border-co-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <Link
                href={calendarHref(month.previousKey, selectedSdr.id, managerView)}
                aria-label="Previous month"
                className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "border-co-border bg-co-surface text-co-ink hover:bg-co-hover")}
              >
                <ChevronLeft className="size-4" />
              </Link>
              <h2 className="min-w-40 text-center text-[15px] font-extrabold text-co-ink">{month.label}</h2>
              <Link
                href={calendarHref(month.nextKey, selectedSdr.id, managerView)}
                aria-label="Next month"
                className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "border-co-border bg-co-surface text-co-ink hover:bg-co-hover")}
              >
                <ChevronRight className="size-4" />
              </Link>
              <Link
                href={calendarHref(undefined, selectedSdr.id, managerView)}
                className="ml-1 text-[11.5px] font-bold text-co-blue hover:underline"
              >
                Today
              </Link>
            </div>

            {managerView && selectableSdrs.length ? (
              <form action="/sdr/calendar" method="get" className="flex items-center gap-2">
                <input type="hidden" name="month" value={month.key} />
                <label htmlFor="sdr-calendar-owner" className="text-[11px] font-bold text-co-text-3">
                  SDR calendar
                </label>
                <select
                  id="sdr-calendar-owner"
                  name="sdr"
                  defaultValue={selectedSdr.id}
                  className={cn(fieldClass, "w-52 border-co-control bg-co-surface text-co-ink")}
                >
                  {selectableSdrs.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
                <button type="submit" className="h-9 rounded-[8px] bg-co-blue px-3 text-[12px] font-bold text-white hover:bg-co-blue-hover">
                  View
                </button>
              </form>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-7 border-b border-co-border bg-co-sunken-2">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="px-2 py-2 text-center text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day, index) => {
                  const dayEvents = eventsByDay.get(day.key) ?? [];
                  const isToday = day.key === todayKey;
                  return (
                    <div
                      key={day.key}
                      className={cn(
                        "min-h-28 border-b border-r border-co-divider p-2",
                        index % 7 === 6 && "border-r-0",
                        index >= 35 && "border-b-0",
                        !day.inMonth && "bg-co-sunken",
                        isToday && "bg-co-accent-bg"
                      )}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span
                          className={cn(
                            "inline-flex size-6 items-center justify-center rounded-full text-[11px] font-bold",
                            day.inMonth ? "text-co-text-2" : "text-co-disabled",
                            isToday && "bg-co-blue text-white"
                          )}
                        >
                          {day.dayNumber}
                        </span>
                        {dayEvents.length ? <span className="text-[9.5px] font-bold text-co-muted-2">{dayEvents.length}</span> : null}
                      </div>
                      <div className="space-y-1">
                        {dayEvents.slice(0, 3).map((event) => (
                          <Link
                            key={event.id}
                            href={`/crm/contacts/${event.contactId}`}
                            title={`${event.title} · ${event.companyName}`}
                            className={cn(
                              "block rounded-[6px] border px-1.5 py-1 transition-colors hover:brightness-95",
                              eventTone(event)
                            )}
                          >
                            <span className="block truncate text-[9.5px] font-extrabold">
                              {formatEventTime(event.dueAt, timeZone)} · {event.title}
                            </span>
                            <span className="block truncate text-[9px] opacity-75">{event.companyName}</span>
                          </Link>
                        ))}
                        {dayEvents.length > 3 ? (
                          <div className="px-1 text-[9.5px] font-bold text-co-muted-2">+{dayEvents.length - 3} more</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {monthEvents.length === 0 ? (
            <div className="border-t border-co-border px-4 py-5 text-center text-[12px] text-co-muted-2">
              No SDR-scheduled follow-ups in {month.label}. Automatic first-touch reminders are intentionally excluded.
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function uniqueUsers(users: User[]) {
  return [...new Map(users.map((user) => [user.id, user])).values()].sort((left, right) => left.name.localeCompare(right.name));
}

function calendarHref(month: string | undefined, ownerUserId: string, includeOwner: boolean) {
  const query = new URLSearchParams();
  if (month) query.set("month", month);
  if (includeOwner) query.set("sdr", ownerUserId);
  const suffix = query.toString();
  return suffix ? `/sdr/calendar?${suffix}` : "/sdr/calendar";
}

function friendlyTimeZone(timeZone: string) {
  return timeZone.replaceAll("_", " ");
}

function formatEventTime(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
  }
}

function eventTone(event: CalendarReminder) {
  if (event.status === "Overdue") {
    return "border-co-red-border bg-co-red-bg-soft text-co-red-text";
  }
  if (event.channel === "Meeting") {
    return "border-co-teal-border bg-co-teal-bg text-co-teal-text";
  }
  return "border-co-accent-border bg-co-accent-bg text-co-blue-dark";
}

function CalendarStat({
  label,
  value,
  icon: Icon,
  tone
}: {
  label: string;
  value: number;
  icon: typeof CalendarCheck2;
  tone: "blue" | "teal" | "red";
}) {
  const toneClass = {
    blue: "bg-co-accent-bg text-co-blue",
    teal: "bg-co-teal-bg text-co-teal-text",
    red: "bg-co-red-bg-soft text-co-red-text"
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-co-border bg-co-surface p-3">
      <span className={cn("flex size-9 items-center justify-center rounded-[8px]", toneClass)}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-[19px] font-extrabold tabular-nums text-co-ink">{value}</span>
        <span className="block text-[10.5px] font-bold text-co-muted-2">{label}</span>
      </span>
    </div>
  );
}
