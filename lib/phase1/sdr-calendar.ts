type FollowUpTitle = { title: string };

/**
 * Assignment creates an SLA reminder named "First touch …" before the SDR has
 * done any work. My Day and the personal calendar are for follow-ups the SDR
 * scheduled after a touch, so keep those system reminders out of both views.
 */
export function isSdrScheduledFollowUp(reminder: FollowUpTitle): boolean {
  return !/^first[\s-]+touch\b/i.test(reminder.title.trim());
}

export type SdrCalendarMonth = {
  year: number;
  monthIndex: number;
  key: string;
  label: string;
  previousKey: string;
  nextKey: string;
};

export type SdrCalendarDay = {
  key: string;
  dayNumber: number;
  inMonth: boolean;
};

export function resolveSdrCalendarMonth(
  value: string | undefined,
  now: Date = new Date(),
  timeZone = "UTC"
): SdrCalendarMonth {
  const parsed = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  const currentKey = dateKeyInTimeZone(now, timeZone).slice(0, 7);
  const selectedKey = parsed && Number(parsed[2]) >= 1 && Number(parsed[2]) <= 12 ? value! : currentKey;
  const [yearValue, monthValue] = selectedKey.split("-");
  const year = Number(yearValue);
  const monthIndex = Number(monthValue) - 1;
  const selected = new Date(Date.UTC(year, monthIndex, 1));
  const previous = new Date(Date.UTC(year, monthIndex - 1, 1));
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));

  return {
    year,
    monthIndex,
    key: monthKey(selected),
    label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(selected),
    previousKey: monthKey(previous),
    nextKey: monthKey(next)
  };
}

export function buildSdrCalendarDays(month: Pick<SdrCalendarMonth, "year" | "monthIndex">): SdrCalendarDay[] {
  const first = new Date(Date.UTC(month.year, month.monthIndex, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(first.getUTCDate() - first.getUTCDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return {
      key: dateKeyUtc(date),
      dayNumber: date.getUTCDate(),
      inMonth: date.getUTCFullYear() === month.year && date.getUTCMonth() === month.monthIndex
    };
  });
}

export function dateKeyInTimeZone(value: string | Date, timeZone = "UTC"): string {
  const date = value instanceof Date ? value : new Date(value);
  const formatter = datePartsFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function datePartsFormatter(timeZone: string) {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone
  };
  try {
    return new Intl.DateTimeFormat("en-US", options);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
  }
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dateKeyUtc(date: Date) {
  return `${monthKey(date)}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
