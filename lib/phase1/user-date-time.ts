const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

/** Parse a browser datetime-local value in the signed-in user's IANA timezone. */
export function userDateTimeToIso(value: unknown, userTimeZone?: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const input = value.trim();

  // Client components already submit ISO strings in some paths. Preserve their
  // explicit offset instead of applying the user's timezone a second time.
  if (EXPLICIT_ZONE.test(input)) {
    const instant = new Date(input);
    if (Number.isNaN(instant.getTime())) throw new Error("Enter a valid date and time.");
    return instant.toISOString();
  }

  const local = parseLocalParts(input);
  if (!local) throw new Error("Enter a valid date and time.");
  const timeZone = validatedTimeZone(userTimeZone);
  const targetAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    local.millisecond
  );

  // Resolve the zone offset twice because the first candidate may cross a DST
  // boundary. Validation below rejects nonexistent local times such as 02:30 on
  // a spring-forward day instead of silently shifting the reminder.
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = zoneOffsetMilliseconds(new Date(candidate), timeZone);
    candidate = targetAsUtc - offset;
  }

  const instant = new Date(candidate);
  const resolved = partsInTimeZone(instant, timeZone);
  if (!sameWallClock(local, resolved)) {
    throw new Error("That local time does not exist in your configured timezone.");
  }
  return instant.toISOString();
}

function parseLocalParts(input: string): DateParts | null {
  const dateOnly = DATE_ONLY.exec(input);
  if (dateOnly) {
    return partsFromMatch(dateOnly, 9, 0, 0, 0);
  }
  const dateTime = LOCAL_DATE_TIME.exec(input);
  if (!dateTime) return null;
  return partsFromMatch(
    dateTime,
    Number(dateTime[4]),
    Number(dateTime[5]),
    Number(dateTime[6] || 0),
    Number((dateTime[7] || "").padEnd(3, "0") || 0)
  );
}

function partsFromMatch(
  match: RegExpExecArray,
  hour: number,
  minute: number,
  second: number,
  millisecond: number
): DateParts | null {
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour,
    minute,
    second,
    millisecond
  };
  const check = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond)
  );
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day ||
    check.getUTCHours() !== parts.hour ||
    check.getUTCMinutes() !== parts.minute ||
    check.getUTCSeconds() !== parts.second
  ) {
    return null;
  }
  return parts;
}

function validatedTimeZone(value?: string) {
  const timeZone = value?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    throw new Error("Your configured timezone is invalid. Update it in Settings before scheduling work.");
  }
}

function zoneOffsetMilliseconds(instant: Date, timeZone: string) {
  const parts = partsInTimeZone(instant, timeZone);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return representedAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function partsInTimeZone(instant: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: instant.getUTCMilliseconds()
  };
}

function sameWallClock(left: DateParts, right: DateParts) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second &&
    left.millisecond === right.millisecond
  );
}
