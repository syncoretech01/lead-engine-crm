import Link from "next/link";
import {
  BriefcaseBusiness,
  CalendarClock,
  CalendarPlus,
  ListTodo,
  Mail,
  MessageSquareText,
  NotebookPen,
  Phone,
  PlayCircle,
  UserRoundCheck,
  type LucideIcon
} from "lucide-react";

import { CoPill } from "@/components/crm/cockpit/co-table";
import { priorityTone, statusTone } from "@/components/crm/cockpit/focus/focus-types";
import { MyDayProgress, MyDayResume } from "@/components/crm/cockpit/my-day-client";
import type { MyDayActivityKind } from "@/lib/my-day-activity";

// My Day — the SDR's landing (SDR Cockpit §1). A centered "start or resume work"
// hub: counter strip + grouped work queue that deep-links into the Focus
// workspace + a right column of follow-ups, replies, and today's progress. Pure
// display (server component); all data is precomputed by the page.

export type MyDayLead = {
  contactId: string;
  name: string;
  title: string;
  company: string;
  dueLabel: string;
  dueTone: "red" | "amber" | "muted";
  priority: string;
  status: string;
  hasPhone: boolean;
  blocked?: string;
  view: string;
};

export type MyDayGroup = {
  id: string;
  label: string;
  tone: "red" | "blue" | "amber" | "teal" | "gray";
  leads: MyDayLead[];
};

export type MyDayFollowUp = {
  id: string;
  title: string;
  company: string;
  dueLabel: string;
  contactId: string;
  isMeeting: boolean;
};

export type MyDayReply = {
  contactId: string;
  name: string;
  company: string;
  status: string;
};

export type MyDayRecentActivity = {
  id: string;
  kind: MyDayActivityKind;
  verb: string;
  contactName: string;
  companyName: string;
  timeLabel: string;
  href?: string;
};

const groupHeadTone: Record<MyDayGroup["tone"], string> = {
  red: "text-co-red-text",
  blue: "text-co-blue-dark",
  amber: "text-co-amber-text",
  teal: "text-co-teal-text",
  gray: "text-co-muted"
};
const groupDotTone: Record<MyDayGroup["tone"], string> = {
  red: "bg-co-red",
  blue: "bg-co-blue",
  amber: "bg-co-amber-dot",
  teal: "bg-co-teal",
  gray: "bg-co-muted"
};
const activityVisuals: Record<MyDayActivityKind, { icon: LucideIcon; tone: string }> = {
  call: { icon: Phone, tone: "text-co-blue" },
  email: { icon: Mail, tone: "text-co-teal" },
  sms: { icon: MessageSquareText, tone: "text-co-blue-dark" },
  followup: { icon: CalendarPlus, tone: "text-co-amber-text" },
  opportunity: { icon: BriefcaseBusiness, tone: "text-co-teal-text" },
  meeting: { icon: CalendarClock, tone: "text-co-teal-text" },
  note: { icon: NotebookPen, tone: "text-co-text-3" },
  task: { icon: ListTodo, tone: "text-co-text-3" },
  other: { icon: UserRoundCheck, tone: "text-co-muted" }
};

export function MyDay({
  todayLabel,
  sdrName,
  metrics,
  groups,
  recentActivity,
  followUps,
  replies,
  startHref,
  queueCount
}: {
  todayLabel: string;
  sdrName: string;
  metrics: { overdue: number; p1: number; dueToday: number; completedToday: number };
  groups: MyDayGroup[];
  recentActivity: MyDayRecentActivity[];
  followUps: MyDayFollowUp[];
  replies: MyDayReply[];
  startHref: string;
  queueCount: number;
}) {
  return (
    <div className="cockpit min-h-full bg-co-page">
      <div className="mx-auto w-full max-w-[1148px] px-6 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-co-blue">CRM · SDR Workspace</div>
            <h1 className="mt-0.5 text-[22px] font-extrabold text-co-ink">My Day</h1>
            <p className="mt-0.5 text-[12.5px] text-co-text-3">
              {todayLabel}
              {sdrName ? ` · ${sdrName} · SDR` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <MyDayResume />
            <Link
              href={startHref}
              className="flex h-[38px] items-center gap-2 rounded-[9px] bg-co-blue px-4 text-[13px] font-bold text-white transition-colors hover:bg-co-blue-hover"
            >
              <PlayCircle className="size-4" aria-hidden="true" />
              Start calling
            </Link>
          </div>
        </div>

        {/* Counter strip */}
        <div className="mt-4 grid grid-cols-2 divide-y divide-co-divider rounded-[10px] border border-co-border bg-co-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Counter tone="red" label="Overdue" value={metrics.overdue} />
          <Counter tone="blue" label="P1 leads" value={metrics.p1} />
          <Counter tone="amber" label="Due today" value={metrics.dueToday} />
          <Counter tone="teal" label="Completed today" value={metrics.completedToday} />
        </div>

        {/* Main grid */}
        <div className="mt-5 grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[1fr_316px]">
          {/* Work queue — on large screens it fills the right column's height and
              scrolls internally (the inner card is absolutely positioned, so its
              intrinsic height doesn't stretch the row past the right column). */}
          <div className="lg:relative">
            <div className="flex flex-col overflow-hidden rounded-[10px] border border-co-border bg-co-surface lg:absolute lg:inset-0">
              <div className="flex shrink-0 items-center justify-between border-b border-co-border px-4 py-3">
                <h2 className="text-[13px] font-extrabold text-co-ink">Work queue</h2>
                <span className="text-[11px] font-bold text-co-muted-2">{queueCount} active</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
              {groups.map((group) => (
                <div key={group.id}>
                  <div className="flex items-center gap-2 bg-co-sunken-2 px-4 py-1.5">
                    <span className={`size-2 rounded-full ${groupDotTone[group.tone]}`} aria-hidden="true" />
                    <span className={`text-[10.5px] font-extrabold uppercase tracking-[0.06em] ${groupHeadTone[group.tone]}`}>
                      {group.label}
                    </span>
                    <span className="text-[10.5px] font-bold text-co-muted-2">{group.leads.length}</span>
                  </div>
                  {group.leads.map((lead) => (
                    <Link
                      key={`${group.id}-${lead.contactId}`}
                      href={`/sdr/focus?lead=${encodeURIComponent(lead.contactId)}&view=${lead.view}`}
                      className="grid grid-cols-[64px_minmax(140px,1fr)_auto] items-center gap-3 border-b border-co-divider px-4 py-2.5 transition-colors last:border-0 hover:bg-co-hover"
                    >
                      <span
                        className={`text-[11px] font-bold ${
                          lead.dueTone === "red"
                            ? "text-co-red-text"
                            : lead.dueTone === "amber"
                              ? "text-co-amber-text"
                              : "text-co-muted-2"
                        }`}
                      >
                        {lead.dueLabel}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-co-ink">{lead.name}</span>
                        <span className="block truncate text-[11.5px] text-co-muted-2">
                          {[lead.title, lead.company].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        <CoPill tone={priorityTone(lead.priority)}>{lead.priority}</CoPill>
                        <CoPill tone={statusTone(lead.status)}>{lead.status}</CoPill>
                        {lead.blocked ? (
                          <span className="text-[10.5px] font-bold text-co-red-text">{lead.blocked}</span>
                        ) : lead.hasPhone ? (
                          <Phone className="size-3.5 text-co-teal" aria-hidden="true" />
                        ) : (
                          <span className="text-[10.5px] font-bold text-co-red-text">No phone</span>
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              ))}
              {groups.length === 0 ? (
                <div className="px-4 py-12 text-center text-[12.5px] text-co-muted">
                  Your queue is clear — nothing needs attention right now.
                </div>
              ) : null}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-5">
            <SideCard title="Recent activity">
              {recentActivity.length ? (
                recentActivity.map((item) => {
                  const visual = activityVisuals[item.kind];
                  const Icon = visual.icon;
                  const content = (
                    <>
                      <Icon className={`mt-0.5 size-3.5 shrink-0 ${visual.tone}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-co-ink">
                          {item.verb} <span className="font-bold">{item.contactName}</span>
                        </span>
                        <span className="block truncate text-[10.5px] text-co-muted-2">{item.companyName}</span>
                      </span>
                      <span className="shrink-0 text-[10.5px] text-co-muted-2">{item.timeLabel}</span>
                    </>
                  );

                  return item.href ? (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="flex items-start gap-2 border-b border-co-divider py-2 last:border-0 hover:bg-co-hover"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={item.id} className="flex items-start gap-2 border-b border-co-divider py-2 last:border-0">
                      {content}
                    </div>
                  );
                })
              ) : (
                <Empty>No recent activity yet.</Empty>
              )}
            </SideCard>

            <SideCard title="Upcoming follow-ups">
              {followUps.length ? (
                followUps.map((item) => (
                  <Link
                    key={item.id}
                    href={`/crm/contacts/${item.contactId}`}
                    className="flex flex-col gap-0.5 border-b border-co-divider py-2 last:border-0 hover:bg-co-hover"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-bold text-co-ink">{item.title}</span>
                      <span className="shrink-0 text-[11px] text-co-text-3">{item.dueLabel}</span>
                    </div>
                    <span className="truncate text-[11px] text-co-muted-2">{item.company}</span>
                    {item.isMeeting ? (
                      <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-co-teal-bg px-2 py-0.5 text-[10px] font-bold text-co-teal-text">
                        <CalendarClock className="size-3" aria-hidden="true" />
                        Meeting booked — reminder
                      </span>
                    ) : null}
                  </Link>
                ))
              ) : (
                <Empty>No upcoming follow-ups.</Empty>
              )}
              <p className="mt-2 border-t border-co-divider pt-2 text-[10.5px] text-co-muted-2">
                Only follow-ups you schedule appear here. Booked meetings are included in your calendar.
              </p>
              <Link href="/sdr/calendar" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-co-blue hover:underline">
                <CalendarClock className="size-3.5" aria-hidden="true" />
                Open my calendar
              </Link>
            </SideCard>

            <SideCard title="Recent replies">
              {replies.length ? (
                replies.map((reply) => (
                  <Link
                    key={reply.contactId}
                    href={`/sdr/focus?lead=${encodeURIComponent(reply.contactId)}&view=replied`}
                    className="flex items-center justify-between gap-2 border-b border-co-divider py-2 last:border-0 hover:bg-co-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-bold text-co-ink">{reply.name}</span>
                      <span className="block truncate text-[11px] text-co-muted-2">{reply.company}</span>
                    </span>
                    <CoPill tone={statusTone(reply.status)}>{reply.status}</CoPill>
                  </Link>
                ))
              ) : (
                <Empty>No new replies.</Empty>
              )}
            </SideCard>

            <SideCard title="Today's progress">
              <MyDayProgress />
            </SideCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function Counter({ tone, label, value }: { tone: MyDayGroup["tone"]; label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className={`size-2 rounded-full ${groupDotTone[tone]}`} aria-hidden="true" />
        <span className="text-[11px] font-bold text-co-text-3">{label}</span>
      </div>
      <span className="text-[22px] font-extrabold tabular-nums text-co-ink">{value}</span>
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-co-border bg-co-surface p-4">
      <h3 className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">{title}</h3>
      <div>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-[12px] text-co-muted-2">{children}</div>;
}
